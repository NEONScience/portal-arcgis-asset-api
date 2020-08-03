# Portal ArcGIS Asset API

A lightweight API for serving assets from the [Neon ArcGIS Gallery](https://neon.maps.arcgis.com/home/gallery.html) as GeoJSON implemented in [Koa](https://koajs.com/).

This API serves as a stop-gap only. Ultimately NEON plans to serve a comprehensive ArcGIS API for all public ArcGIS assets (well beyond what is supported here). The primary consumer of this API is the [NEON SiteMap](https://cert-data.neonscience.org/core-components#SiteMap), an interactive map build in React and Leaflet.

## Usage

**`$ node api.js`**

Start the API. Loads `features.json` first to know what assets are available then reads and stores *all* assets in an in-memory cache. Spawns workers based on available CPUs for clustering while maintaining a single common cache instance. Requests for assets are filled from this cache.

Present asset footprint on disk is about 38MB (see `/assets` directory) so all in-memory cache is easily manageable.

**`$ node build.js`**

Rebuild all assets from the [source](https://neon.maps.arcgis.com/home/gallery.html). Assets are downloaded from the ArcGIS gallery and processed from shapefiles into GeoJSON in the **`/assets`** directory.

In addition a `features.json` file is created in the root directory. This JSON contains a structure describing all available features and all sites available for each feature. This is used at runtime to inform the API how to build the cache and know which requests are valid without recursive directory traversal or the risk of unexpected assets being somehow present.

Note that all assets and the `features.json` map are in version control. This is because assets rarely change, so for simplicity rebuilding assets should only be done in a development environment as-needed and the updates pushed as a new version of the API.

## Querying

Once up and running (by default on port 3100) requests can be made to the API to fetch asset data or information about what assets are available.

Assets are represented by NEON field site divided into common groups called Features. Querying the root provides the list of available features.

```
> http://localhost:3100/api/v0/arcgis-assets/
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
> http://localhost:3100/api/v0/arcgis-assets/TOWER_AIRSHEDS/
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
> http://localhost:3100/api/v0/arcgis-assets/TOWER_AIRSHEDS/ABBY
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
