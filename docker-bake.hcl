# Populated from GitHub Action
variable "REPO" {
  default = ""
}

group "default" {
  targets = [
    "portal-arcgis-asset-api",
  ]
}

# Populated from GitHub Action
target "docker-metadata-action" {
  tags = []
}

target "bootstrap" {
  platforms = [ "linux/amd64" ]
  no-cache = true
}

target "portal-arcgis-asset-api" {
  inherits = ["bootstrap", "docker-metadata-action"]
  tags = [for tag in target.docker-metadata-action.tags : tag]
  dockerfile = "bake.Dockerfile"
}
