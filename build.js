'use strict';

const startTime = Date.now();

process.env.NODE_ENV = 'DEVELOPMENT';

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', err => {
  throw err;
});

const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');
const shp = require('shpjs');
const fetch = require('node-fetch');
const log = require('./logger');

const DOWNLOADS_PATH = path.join(__dirname, 'downloads');
const ASSETS_PATH = path.join(__dirname, 'assets');

// Shape Files that we download and parse into geojson
const FEATURE_SOURCES = {
  TOWER_AIRSHEDS: {
    sourceId: 'd87cd176dd6a468294fc0ac70918c631',
    zipFile: '90percentfootprint.zip',
    parsed: false,
  },
  AQUATIC_REACHES: {
    sourceId: '2391e7b863d74afcb066401224e28552',
    zipFile: 'AquaticReach.zip',
    parsed: false,
  },
  FLIGHT_BOX_BOUNDARIES: {
    sourceId: 'f27616de7f9f401b8732cdf8902ab1d8',
    zipFile: 'AOP_Flightboxes.zip',
    parsed: false,
  },
  SAMPLING_BOUNDARIES: {
    sourceId: '4a381f124a73490aa9ad7b1df914d6d8',
    zipFile: 'Field_Sampling_Boundaries.zip',
    parsed: false,
  },
  AQUATIC_WATERSHEDS: {
    sourceId: '869c18de0c874c33b352efad0778a07a',
    zipFile: 'NEONAquaticWatershed.zip',
    parsed: false,
  },
  /*
  DRAINAGE_LINES: {
    sourceId: '--GET-FROM-JEREMY-OR-CHRISTINE',
    zipFile: 'NEON-GET_FILE_NAME.zip',
    parsed: false,
  },
  */
  POUR_POINTS: {
    sourceId: '869c18de0c874c33b352efad0778a07a',
    zipFile: 'NEON-NEONPour_Points.zip',
    parsed: false,
  },
};

Object.keys(FEATURE_SOURCES).forEach((key) => { FEATURE_SOURCES[key].KEY = key; });
const getSourceURL = sourceId => `https://neon.maps.arcgis.com/sharing/rest/content/items/${sourceId}/data`;


// Feature data that we extract fdrom above geojson. Note that there is NOT a 1:1 correlation
// of feature sources to features... some sources may be parsed out into more than one feature.
const FEATURES = {
  TOWER_AIRSHEDS: {
    source: FEATURE_SOURCES.TOWER_AIRSHEDS.KEY,
    getProperties: (properties) => {
      const { SiteID: siteCode } = properties;
      return { siteCode };
    },
  },
  AQUATIC_REACHES: {
    source: FEATURE_SOURCES.AQUATIC_REACHES.KEY,
    getProperties: (properties) => {
      const { SiteID: siteCode, HUC12, UTM_Zone, AreaKm2: areaKm2 } = properties;
      return { siteCode, HUC12, UTM_Zone, areaKm2 };
    },
  },
  FLIGHT_BOX_BOUNDARIES: {
    source: FEATURE_SOURCES.FLIGHT_BOX_BOUNDARIES.KEY,
    getProperties: (properties) => {
      const { siteID: siteCode, priority, version, flightbxID: flightBoxId } = properties;
      return { siteCode, priority, version, flightBoxId };
    },
  },
  SAMPLING_BOUNDARIES: {
    source: FEATURE_SOURCES.SAMPLING_BOUNDARIES.KEY,
    getProperties: (properties) => {
      const { siteID: siteCode, areaKm2 } = properties;
      return { siteCode, areaKm2 };
    },
  },
  WATERSHED_BOUNDARIES: {
    source: FEATURE_SOURCES.AQUATIC_WATERSHEDS.KEY,
    geojsonFileName: 'NEON_Aquatic_Watershed',
    getProperties: (properties) => {
      const { SiteID: siteCode, UTM_Zone, WSAreaKm2 } = properties;
      const areaKm2 = parseFloat(WSAreaKm2, 10);
      return { siteCode, UTM_Zone, areaKm2: areaKm2 || null };
    }
  },
  DRAINAGE_LINES: {
    source: FEATURE_SOURCES.AQUATIC_WATERSHEDS.KEY,
    geojsonFileName: 'NEON_Aquatic_DrainageLine',
    getProperties: (properties) => {
      const { SiteID: siteCode } = properties;
      return { siteCode };
    }
  },
  POUR_POINTS: {
    source: FEATURE_SOURCES.AQUATIC_WATERSHEDS.KEY,
    geojsonFileName: 'NEON_Aquatic_PourPoint',
    getProperties: (properties) => {
      const { siteCode } = properties;
      return { siteCode };
    }
  },
};

// JSON structure used by the API to know what routes exist; built here as we go
const featuresJSON = {};
Object.keys(FEATURES).forEach(featureKey => featuresJSON[featureKey] = []);

// Shapefiles from the ArcGIS Gallery processed through shpjs produce [lon, lat] coordinates.
// Leaflet interprets coordinates as [lat,lon], so we have to flip every coordinate.
// Coordinates can also be deeply nested as in a MultiPolygon set, so do it recursively.
const sanitizeCoordinates = (coords) => {
  if (!Array.isArray(coords)) { return coords; }
  let sanitizedCoords = [];
  if (Array.isArray(coords[0])) {
    sanitizedCoords = coords.map(arr => sanitizeCoordinates(arr));
  } else {
    // Watershed boundaries can potentially have 3 coordinate values...
    // Account for this and take the lon,lat presented
    if ((coords.length === 2 || coords.length === 3) && coords.every(c => Number.isFinite(c))) {
      // Sanity check to ensure proper interpretation of coords
      if (coords.length === 3) {
        if (coords[2] !== 0) {
          log.warn(`Identified coord with non-zero z: ${coords}`);
        }
      }
      const [x, y] = coords;
      // All NEON features are in the north and west hemispheres, so latitude should always be
      // positive and longitude should always be negative.
      if (x < 0) {
        sanitizedCoords.push(y);
        sanitizedCoords.push(x);
      } else {
        log.warn(`Identified coord with negative x: ${coords}`);
      }
    } else {
      log.warn(`Failed to determine state of coords: ${coords}`);
    }
  }
  return sanitizedCoords;
};

// Parse a converted single geojson object for a feature into a dictionary of geojson objects
// keyed by siteCode. Also sanitize coordinates and properties.
// getProperties function comes from FEATURES
const geojsonToSites = (geojson = {}, getProperties = p => p) => {
  const sites = {};
  if (!geojson.features) { return sites; }

  geojson.features.forEach((feature) => {
    if (!feature.geometry) { return; } 
    const geometry = {
      type: feature.geometry.type,
      coordinates: sanitizeCoordinates(feature.geometry.coordinates),
    };
    const properties = getProperties(feature.properties);
    const { siteCode, areaKm2 } = properties;
    if (!siteCode) { return; }
    if (!sites[siteCode]) {
      sites[siteCode] = { type: 'Feature', properties, geometry };
    } else {
      if (areaKm2 && sites[siteCode].properties.areaKm2) {
        sites[siteCode].properties.areaKm2 += areaKm2;
      }
      sites[siteCode].geometry.coordinates.push(geometry.coordinates);
    }
  });

  return sites;
};

// Create a directory of geojson files named for their site (e.g. ABBY.json)
const generateFeatureSiteFilesDirectory = (featureKey, sitesData) => {
  if (!Object.keys(FEATURES).includes(featureKey)) { return 0; }
  let count = 0;
  try {
    const outDir = path.join(ASSETS_PATH, featureKey);
    fs.mkdirSync(outDir);
    Object.keys(sitesData).forEach((siteCode) => {
      const outFile = path.join(outDir, `${siteCode}.json`);
      fs.writeFileSync(outFile, JSON.stringify(sitesData[siteCode]));
      count += 1;
    });
  } catch (err) {
    log.error(err);
  }
  return count;
};

log.info('=== Building Deferred JSON Artifacts ===\n');

// Extract feature data from converted geojson and render out to files (async step)
const GEOJSON_SOURCES = {};
const generateOutfiles = () => {
  log.info('\n- Generating feature data files');
  Object.keys(FEATURES).forEach((key) => {
    const feature = FEATURES[key];
    const { source } = feature;
    if (!source || !GEOJSON_SOURCES[source]) {
      log.error(`- - ${key} unable to generate; invalid source: ${source}`);
      return;
    }
    const geojson = (feature.geojsonFileName
      ? GEOJSON_SOURCES[source].find(fc => fc.fileName === feature.geojsonFileName)
      : GEOJSON_SOURCES[source]) || {};
    log.info(`- - ${key} - Parsing sites...`);
    const sites = geojsonToSites(geojson, feature.getProperties);

    const expectedSiteCount = Object.keys(sites).length;
    if (!expectedSiteCount) {
      log.error(`- - ${key} no sites parsed; aborting`);
      return;
    }
    // Add site codes to this feature in featuresJSON
    Object.keys(sites)
      .sort()
      .forEach((siteCode) => {
        featuresJSON[key].push(siteCode);
      });
    log.info(`- - ${key} - Writing site JSON files...`);
    const resultSiteCount = generateFeatureSiteFilesDirectory(key, sites);
    if (resultSiteCount !== expectedSiteCount) {
      log.error(`- - ${key} expected ${expectedSiteCount} site files; ${resultSiteCount} generated:`);
    } else {
      log.success(`- - ${key} generated ${resultSiteCount} site files`);
    }
  });
};

// Clear the ASSETS_PATH directory
log.info('- Clearing assets directory');
fsExtra.emptyDirSync(ASSETS_PATH);

// Initialize the DOWNLOADS_PATH directory
log.info('- Making downloads directory');
try {
  const downloadsStats = fs.statSync(DOWNLOADS_PATH);
  fsExtra.emptyDirSync(DOWNLOADS_PATH);
  fs.rmdirSync(DOWNLOADS_PATH);
} catch (err) {
  // downloads dir doesn't exist; do nothing
}
fs.mkdirSync(DOWNLOADS_PATH);

// Download shape files
const downloadPromises = [];
Object.keys(FEATURE_SOURCES).forEach((key) => {
  const { sourceId, zipFile } = FEATURE_SOURCES[key];
  log.info(`- - ZIP: ${zipFile} - Fetching...`);

  const url = getSourceURL(sourceId);
  console.log("res===>%s\s", url);
  const promise = fetch(url)
    .then(res => {
      return new Promise((resolve, reject) => {

        const dest = fs.createWriteStream(path.join(DOWNLOADS_PATH, zipFile));
        dest.on('finish', () => {
          log.success(`- - ZIP: ${zipFile} - Fetched`);
          resolve(true);
        });
        res.body.pipe(dest);
      });
    });
  downloadPromises.push(promise);
});

// After download is complete: convert all shape files to geojson
Promise.all(downloadPromises).then(() => {
  log.info('\n- Converting feature source ZIP files to geojson');
  Object.keys(FEATURE_SOURCES).forEach((key) => {
    const featureSource = FEATURE_SOURCES[key];
    const { zipFile } = featureSource;
    log.info(`- - ZIP: ${zipFile} - Reading...`);
    fs.readFile(path.join(DOWNLOADS_PATH, zipFile), (err, data) => {
      if (err) {
        log.error(`- - ZIP: ${zipFile} unable to read:`);
        log.error(err, '');
        return;
      }
      log.info(`- - ZIP: ${zipFile} read complete; converting shapes...`);
      shp(data).then((geojson) => {
        GEOJSON_SOURCES[key] = geojson;
        log.success(`- - ZIP: ${zipFile} to geojson conversion complete`);
        // Spit out whole geojson if needed for setting up new features
        // const outFile = path.join(ASSETS_PATH, `${key}.json`);
        // fs.writeFileSync(outFile, JSON.stringify(geojson, null, 2));
        FEATURE_SOURCES[key].parsed = true;
        if (Object.keys(FEATURE_SOURCES).every(source => FEATURE_SOURCES[source].parsed)) {
          generateOutfiles();
          finalize();
        }
	    });
    });
  });
});

const finalize = () => {
  // Generate features.json
  log.info('\n- Regenerating features.json');
  try {
    const stats = fs.statSync('./features.json');
    log.info(`- - Deleting existing features.json...`);
    fs.unlinkSync('./features.json');
  } catch (err) {
    // features.json doesn't exist; do nothing
  }
  fs.writeFileSync('./features.json', JSON.stringify(featuresJSON));
  log.success(`- - Regenerated features.json successfully`);

  // Delete all downloads
  log.info('\n- Clearing downloads directory');
  fsExtra.emptyDirSync(DOWNLOADS_PATH);
  log.info('- Removing downloads directory');
  fs.rmdirSync(DOWNLOADS_PATH);
  
  // Done!
  const executionTime = (Date.now() - startTime) / 1000;
  log.success(`\nDone. (${executionTime}s)`);
};
