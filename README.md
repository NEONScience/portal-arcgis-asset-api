# Portal ArcGIS Asset API

A lightweight API for serving assets from the [Neon ArcGIS Gallery](https://neon.maps.arcgis.com/home/gallery.html) as GeoJSON implemented in [Koa](https://koajs.com/).

This API serves as a stop-gap only. Ultimately NEON plans to serve a comprehensive ArcGIS API for all public ArcGIS assets (well beyond what is supported here). The primary consumer of this API is the [NEON SiteMap](https://cert-data.neonscience.org/core-components#SiteMap), an interactive map build in React and Leaflet.

## Usage

**`$ node api.js`**

Start the API. Loads `features.json` first to know what assets are available, then reads, gzips, and caches *all* assets in an in-memory cache. Requests for assets are filled from this cache. We can get away with this because presently the total footprint of assets on disk is only a few megabytes.

**`$ node build.js`**

Rebuild all assets from the [source](https://neon.maps.arcgis.com/home/gallery.html). Assets are downloaded from the ArcGIS gallery and processed from shapefiles into GeoJSON in the **`assets`** directory. In addition a `features.json` file is created in the root directory which serves as the whitelist of available assets so the API knows what to cache and what routes are valid.

Note that all assets and the `features.json` map are in version control. This is because assets rarely change, so for simplicity rebuilding assets should only be done in a development environment as-needed and the updates pushed as a new version of the API.

## Querying

Once up and running (by default on port 3100) requests can be made to the API to fetch asset data or information about what assets are available.

Assets are represented by NEON field site divided into common groups called Features. Querying the root provides the list of available features.

```
> http://localhost:3100/api/arcgis-assets/
{
  "features": [
    "TOWER_AIRSHEDS",
    "AQUATIC_REACHES",
    ...
  ]
}
```
Querying a feature provides the list of site codes available for the feature:

```
> http://localhost:3100/api/arcgis-assets/TOWER_AIRSHEDS/
{
  "siteCodes": [
    "ABBY",
    "BARR",
    ...
  ]
}
```

And querying a valid feature / site code combination will return Gzipped GeoJSON:

```
> http://localhost:3100/api/arcgis-assets/TOWER_AIRSHEDS/ABBY
{
  "type": "Feature",
  "properties": {
    "siteCode": "ABBY"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [ ... ]
  }
}
```
