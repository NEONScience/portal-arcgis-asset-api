'use strict';

class AssetBuilder {
  constructor() {
    this.startTime = Date.now();
    process.env.NODE_ENV = 'DEVELOPMENT';
    this.path = require('path');
    this.fs = require('fs');
    this.fsExtra = require('fs-extra');
    this.shp = require('shpjs');
    this.fetch = require('node-fetch');
    this.log = require('./logger');

    this.DOWNLOADS_PATH = this.path.join(__dirname, 'downloads');
    this.ASSETS_PATH = this.path.join(__dirname, 'assets');

    this.FEATURE_SOURCES = {
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
      DRAINAGE_LINES: {
        sourceId: '869c18de0c874c33b352efad0778a07a',
        zipFile: 'NEONAquaticWatershed.zip',
        parsed: false,
      },
      POUR_POINTS: {
        sourceId: '869c18de0c874c33b352efad0778a07a',
        zipFile: 'NEONAquaticWatershed.zip',
        parsed: false,
      },
    };

    Object.keys(this.FEATURE_SOURCES).forEach((key) => { this.FEATURE_SOURCES[key].KEY = key; });
    this.getSourceURL = sourceId => `https://neon.maps.arcgis.com/sharing/rest/content/items/${sourceId}/data`;
    this.checkFileExists = (filePath) => this.fs.existsSync(filePath);

    this.FEATURES = {
      TOWER_AIRSHEDS: {
        source: this.FEATURE_SOURCES.TOWER_AIRSHEDS.KEY,
        getProperties: (properties) => {
          const { SiteID: siteCode } = properties;
          return { siteCode };
        },
      },
      AQUATIC_REACHES: {
        source: this.FEATURE_SOURCES.AQUATIC_REACHES.KEY,
        getProperties: (properties) => {
          const { SiteID: siteCode, HUC12, UTM_Zone, AreaKm2: areaKm2 } = properties;
          return { siteCode, HUC12, UTM_Zone, areaKm2 };
        },
      },
      FLIGHT_BOX_BOUNDARIES: {
        source: this.FEATURE_SOURCES.FLIGHT_BOX_BOUNDARIES.KEY,
        getProperties: (properties) => {
          const { siteID: siteCode, priority, version, flightbxID: flightBoxId } = properties;
          return { siteCode, priority, version, flightBoxId };
        },
      },
      SAMPLING_BOUNDARIES: {
        source: this.FEATURE_SOURCES.SAMPLING_BOUNDARIES.KEY,
        getProperties: (properties) => {
          const { siteID: siteCode, areaKm2 } = properties;
          return { siteCode, areaKm2 };
        },
      },
      WATERSHED_BOUNDARIES: {
        source: this.FEATURE_SOURCES.AQUATIC_WATERSHEDS.KEY,
        geojsonFileName: 'NEON_Aquatic_Watershed',
        getProperties: (properties) => {
          const { SiteID: siteCode, UTM_Zone, WSAreaKm2 } = properties;
          const areaKm2 = parseFloat(WSAreaKm2, 10);
          return { siteCode, UTM_Zone, areaKm2: areaKm2 || null };
        }
      },
      DRAINAGE_LINES: {
        source: this.FEATURE_SOURCES.AQUATIC_WATERSHEDS.KEY,
        geojsonFileName: 'NEON_Aquatic_DrainageLine',
        getProperties: (properties) => {
          const { SiteID: siteCode } = properties;
          return { siteCode };
        }
      },
      POUR_POINTS: {
        source: this.FEATURE_SOURCES.POUR_POINTS.KEY,
        geojsonFileName: 'NEON_Aquatic_PourPoint',
        getProperties: (properties) => {
          const { SiteID: siteCode } = properties;
          return { siteCode };
        }
      },
    };

    this.featuresJSON = {};
    Object.keys(this.FEATURES).forEach(featureKey => this.featuresJSON[featureKey] = []);
    this.GEOJSON_SOURCES = {};
  }

  sanitizeCoordinates(coords) {
    if (!Array.isArray(coords)) { return coords; }
    let sanitizedCoords = [];
    if (Array.isArray(coords[0])) {
      sanitizedCoords = coords.map(arr => this.sanitizeCoordinates(arr));
    } else {
      if ((coords.length === 2 || coords.length === 3) && coords.every(c => Number.isFinite(c))) {
        if (coords.length === 3) {
          if (coords[2] !== 0) {
            this.log.warn(`Identified coord with non-zero z: ${coords}`);
          }
        }
        const [x, y] = coords;
        if (x < 0) {
          sanitizedCoords.push(y);
          sanitizedCoords.push(x);
        } else {
          this.log.warn(`Identified coord with negative x: ${coords}`);
        }
      } else {
        this.log.warn(`Failed to determine state of coords: ${coords}`);
      }
    }
    return sanitizedCoords;
  }

  geojsonToSites(geojson = {}, getProperties = p => p) {
    const sites = {};
    if (!geojson.features) { return sites; }
    geojson.features.forEach((feature, x) => {
      if (!feature.geometry) { return; }
      const geometry = {
        type: feature.geometry.type,
        coordinates: this.sanitizeCoordinates(feature.geometry.coordinates),
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
  }

  generateFeatureSiteFilesDirectory(featureKey, sitesData) {
    if (!Object.keys(this.FEATURES).includes(featureKey)) { return 0; }
    let count = 0;
    try {
      const outDir = this.path.join(this.ASSETS_PATH, featureKey);
      this.fs.mkdirSync(outDir);
      Object.keys(sitesData).forEach((siteCode) => {
        const outFile = this.path.join(outDir, `${siteCode}.json`);
        this.fs.writeFileSync(outFile, JSON.stringify(sitesData[siteCode]));
        count += 1;
      });
    } catch (err) {
      this.log.error(err);
    }
    return count;
  }

  generateOutfiles() {
    this.log.info('\n- Generating feature data files');
    Object.keys(this.FEATURES).forEach((key) => {
      const feature = this.FEATURES[key];
      const { source } = feature;

      if (!source || !this.GEOJSON_SOURCES[source]) {
        this.log.error(`- - ${key} unable to generate; invalid source: ${source}`);
        return;
      }
      const geojson = (feature.geojsonFileName
        ? this.GEOJSON_SOURCES[source].find(fc => {
          // console.log("%s === %s, Status: ", fc.fileName, feature.geojsonFileName, fc.fileName.includes(feature.geojsonFileName))
          return fc.fileName.includes(feature.geojsonFileName);
        })
        : this.GEOJSON_SOURCES[source]) || {};

        // console.log("===>>>", geojson)
        // console.log(source, "===>>>>", feature.geojsonFileName);
     
      if (feature.geojsonFileName && !geojson) {
        this.log.error(`- - ${key} could not find geojson with fileName ${feature.geojsonFileName}\n`);
      }

      this.log.info(`- - ${key} - Parsing sites...`);
      const sites = this.geojsonToSites(geojson, feature.getProperties);
      const expectedSiteCount = Object.keys(sites).length;
      if (!expectedSiteCount) {
        this.log.error(`- - ${key} no sites parsed; aborting`);
        return;
      }

      Object.keys(sites)
        .sort()
        .forEach((siteCode) => {
          this.featuresJSON[key].push(siteCode);
        });
      this.log.info(`- - ${key} - Writing site JSON files...`);
      const resultSiteCount = this.generateFeatureSiteFilesDirectory(key, sites);
      if (resultSiteCount !== expectedSiteCount) {
        this.log.error(`- - ${key} expected ${expectedSiteCount} site files; ${resultSiteCount} generated:`);
      } else {
        this.log.success(`- - ${key} generated ${resultSiteCount} site files\n`);
      }
    });
  }

  finalize() {
    this.log.info('\n- Regenerating features.json');
    try {
      const stats = this.fs.statSync('./features.json');
      this.log.info(`- - Deleting existing features.json...`);
      this.fs.unlinkSync('./features.json');
    } catch (err) {
      // features.json doesn't exist; do nothing
    }
    this.fs.writeFileSync('./features.json', JSON.stringify(this.featuresJSON));
    this.log.success(`- - Regenerated features.json successfully`);
    this.log.info('\n- Clearing downloads directory');
    this.fsExtra.emptyDirSync(this.DOWNLOADS_PATH);
    this.log.info('- Removing downloads directory');
    this.fs.rmdirSync(this.DOWNLOADS_PATH);
    const executionTime = (Date.now() - this.startTime) / 1000;
    this.log.success(`\nDone. (${executionTime}s)`);
  }

  async run() {
    this.log.info('=== Building Deferred JSON Artifacts ===\n');
    this.log.info('- Clearing assets directory');
    this.fsExtra.emptyDirSync(this.ASSETS_PATH);
    this.log.info('- Making downloads directory');
    try {
      const downloadsStats = this.fs.statSync(this.DOWNLOADS_PATH);
      this.fsExtra.emptyDirSync(this.DOWNLOADS_PATH);
      this.fs.rmdirSync(this.DOWNLOADS_PATH);
    } catch (err) {
      // downloads dir doesn't exist; do nothing
    }
    this.fs.mkdirSync(this.DOWNLOADS_PATH);
    const downloadPromises = [];

    Object.keys(this.FEATURE_SOURCES).forEach((key) => {
      const { sourceId, zipFile } = this.FEATURE_SOURCES[key];
      this.log.info(`- - ZIP: ${zipFile} - Fetching...`);
      const url = this.getSourceURL(sourceId);
      const pathname = this.path.join(this.DOWNLOADS_PATH, zipFile);
      const status = this.checkFileExists(pathname);
      this.log.info(`- - FileExists Status: ${status}`)
      if (!status) {
        const promise = this.fetch(url)
          .then(res => {
            return new Promise((resolve, reject) => {
              const dest = this.fs.createWriteStream(pathname);
              dest.on('finish', () => {
                this.log.success(`- - ZIP: ${zipFile} - Fetched`);
                resolve(true);
              });
              res.body.pipe(dest);
            });
          });
        downloadPromises.push(promise);
      }
    });

    await Promise.all(downloadPromises);
    this.log.info('\n\n- Converting feature source ZIP files to geojson');

    const geojsonPromises = Object.keys(this.FEATURE_SOURCES).map((key) => {
      return new Promise((resolve) => {
        const featureSource = this.FEATURE_SOURCES[key];
        const { zipFile } = featureSource;
        const shfilename = this.path.join(this.DOWNLOADS_PATH, zipFile);
        this.log.info(`- - ZIP: ${shfilename} - Reading for ${key} ...`);
        this.fs.readFile(shfilename, (err, data) => {
          if (err) {
            this.log.error(`- - ZIP: unable to read ${zipFile} ${err}\n\n`);
            resolve(false);
            return;
          }
          this.log.info(`- - ZIP: ${zipFile} read complete; converting ${key} shapes...`);
          this.shp(data).then((geojson) => {
            this.GEOJSON_SOURCES[key] = geojson;
            this.log.success(`- - ZIP: ${zipFile} to geojson conversion complete\n\n`);
            this.FEATURE_SOURCES[key].parsed = true;
            resolve(true);
          });
        });
      });
    });

    await Promise.all(geojsonPromises);
    this.generateOutfiles();
    this.finalize();
  }
}

(async () => {
  const builder = new AssetBuilder();
  await builder.run();
})();