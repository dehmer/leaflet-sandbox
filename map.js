
// Unlift Leaflet namespace:
const Browser = L.Browser
const DomUtil = L.DomUtil
const DomEvent = L.DomEvent
const Bounds = L.Bounds
const Point = L.Point
const Util = L.Util
const toLatLng = L.latLng
const toTransformation = L.transformation

math.vector    = (x, y)   => [x, y, 1]
math.id        = ()       => math.identity(3)
math.translate = (tx, ty) => math.matrix([[1.0, 0.0,  tx], [0.0, 1.0,  ty], [0.0, 0.0, 1.0]])
math.scale     = (sx, sy) => math.matrix([[ sx, 0.0, 0.0], [0.0,  sy, 0.0], [0.0, 0.0, 1.0]])
math.chain     = ms       => ms.reduce((a, b) => math.multiply(a, b))

// use proj4 projection instead of Leaflet
const project = proj4('EPSG:4326', 'EPSG:3857').forward
const scale = zoom => 256 * (1 << zoom)
const scaleRatio = (to, from) => scale(to) / scale(from)
const scaleBounds = factor => bounds => new Bounds(
  bounds.min.scaleBy(new Point(factor, factor)).floor(),
  bounds.max.scaleBy(new Point(factor, factor)).ceil().subtract([1, 1])
)

L.Map.prototype.getZoomScale = function (toZoom, fromZoom) {
  return scaleRatio(toZoom, fromZoom || this._zoom)
}

const transform = (x, y, zoom) => {
	const R = 6378137
  return math.chain([
    // transformations are applied in reverse order.
    math.scale(scale(zoom), scale(zoom)), // [0, tile extend(zoom)]
    math.translate(0.5, 0.5), // [0, 1]
    math.scale(0.5 / (Math.PI * R), -0.5 / (Math.PI * R)), // [-0.5, +0.5]
    math.vector(x, y) // [-π * R, +π * R]
  ]).valueOf()
}

// WGS84 -> pixel coordinate for zoom level and 256 pixel tile size [0, 256 * 2 ^ zoom]
L.CRS.EPSG3857.latLngToPoint = function(latlng, zoom) {
  const {lng, lat} = latlng
  const [px, py] = project([lng, lat]) // WGS84 -> EPSG:3857 [+/- π * R meters]
  const [tx, ty] = transform(px, py, zoom)
  return new Point(tx, ty)
}

L.GridLayer.prototype._getTiledPixelBounds = function (center) {
  const map = this._map
  const mapZoom = map._animatingZoom ? Math.max(map._animateToZoom, map._zoom) : map._zoom
  const pixelCenter = map.project(center, this._tileZoom).floor()
  const scale = map.getZoomScale(mapZoom, this._tileZoom)
  const halfSize = map.getSize().divideBy(scale * 2)
  return new Bounds(pixelCenter.subtract(halfSize), pixelCenter.add(halfSize))
}

L.GridLayer.prototype._update = function (center) {
  if(!this._map) return
  if(!this._tileZoom) return // out of minZoom/maxZoom bounds
  const map = this._map;

  // _update just loads more tiles. If the tile zoom level differs too much
  // from the map's, let _setView reset levels and prune old tiles.
  if (Math.abs(map._zoom - this._tileZoom) > 1) {
    this._setView(center, map._zoom)
    return
  }

  center = center || map.getCenter()
  const pixelBounds = this._getTiledPixelBounds(center)
  const tileRange = scaleBounds(1 / this.options.tileSize)(pixelBounds)

  // Sanity check: panic if the tile range contains Infinity somewhere.
  if (!(isFinite(tileRange.min.x) &&
        isFinite(tileRange.min.y) &&
        isFinite(tileRange.max.x) &&
        isFinite(tileRange.max.y))) {
    throw new Error('Attempted to load an infinite number of tiles')
  }

  // Mark tiles no longer in range as garbage:
  const zNotInRange  = Object.values(this._tiles).filter(tile => tile.coords.z !== this._tileZoom)
  const xyNotInRange = Object.values(this._tiles).filter(tile => !tileRange.contains(new Point(tile.coords.x, tile.coords.y)))
  ;[...zNotInRange, ...xyNotInRange].forEach(tile => tile.current = false)

  // Generate list of (valid) tile coordinates:
  const xRange = R.range(tileRange.min.x, tileRange.max.x + 1)
  const yRange = R.range(tileRange.min.y, tileRange.max.y + 1)
  const coords = xRange.flatMap(x => yRange.map(y => new Point(x, y)))
    .map(coords => { coords.z = this._tileZoom; return coords })
    .filter(coords => this._isValidTile(coords))

  const [update, queue] = R.partition(coords => this._tiles[this._tileCoordsToKey(coords)], coords)
  update
    .map(coords => this._tiles[this._tileCoordsToKey(coords)])
    .forEach(tile => tile.current = true)

  if(!queue.length) return // nothing to fetch

  if (!this._loading) {
    this._loading = true;
    // @event loading: Event
    // Fired when the grid layer starts loading tiles.
    this.fire('loading');
  }

  // create DOM fragment to append tiles in one batch
  const fragment = document.createDocumentFragment();
  const distanceToCenter = point => point.distanceTo(tileRange.getCenter())
  const distanceDifference = (a, b) => distanceToCenter(a) - distanceToCenter(b)
  R.sort(distanceDifference, queue).forEach(coords => this._addTile(coords, fragment))
  this._level.el.appendChild(fragment)
}

L.GridLayer.prototype._addTile = function (coords, container) {
  const tilePos = this._getTilePos(coords)
  const key = this._tileCoordsToKey(coords)
  const tile = this.createTile(this._wrapCoords(coords), Util.bind(this._tileReady, this, coords));

  this._initTile(tile);

  // if createTile is defined with a second argument ("done" callback),
  // we know that tile is async and will be ready later; otherwise
  if (this.createTile.length < 2) {
    // mark tile as ready, but delay one frame for opacity animation to happen
    Util.requestAnimFrame(Util.bind(this._tileReady, this, coords, null, tile));
  }

  DomUtil.setPosition(tile, tilePos);

  // save tile in cache
  this._tiles[key] = {
    el: tile,
    coords: coords,
    current: true
  };

  container.appendChild(tile);
  // @event tileloadstart: TileEvent
  // Fired when a tile is requested and starts loading.
  this.fire('tileloadstart', {
    tile: tile,
    coords: coords
  });
}

L.GridLayer.prototype._initTile = function (tile) {
  DomUtil.addClass(tile, 'leaflet-tile');

  const tileSize = this.getTileSize();
  tile.style.width = tileSize.x + 'px';
  tile.style.height = tileSize.y + 'px';
  tile.onselectstart = R.always(false)
  tile.onmousemove = R.always(false)
}

L.GridLayer.prototype._tileReady = function (coords, err, tile) {
  if (err) {
    // @event tileerror: TileErrorEvent
    // Fired when there is an error loading a tile.
    this.fire('tileerror', {
      error: err,
      tile: tile,
      coords: coords
    });
  }

  var key = this._tileCoordsToKey(coords);

  tile = this._tiles[key];
  if (!tile) { return; }

  tile.loaded = +new Date();
  if (this._map._fadeAnimated) {
    DomUtil.setOpacity(tile.el, 0);
    Util.cancelAnimFrame(this._fadeFrame);
    this._fadeFrame = Util.requestAnimFrame(this._updateOpacity, this);
  } else {
    tile.active = true;
    this._pruneTiles();
  }

  if (!err) {
    DomUtil.addClass(tile.el, 'leaflet-tile-loaded');

    // @event tileload: TileEvent
    // Fired when a tile loads.
    this.fire('tileload', {
      tile: tile.el,
      coords: coords
    });
  }

  if (this._noTilesToLoad()) {
    this._loading = false;
    // @event load: Event
    // Fired when the grid layer loaded all visible tiles.
    this.fire('load');

    if (Browser.ielt9 || !this._map._fadeAnimated) {
      Util.requestAnimFrame(this._pruneTiles, this);
    } else {
      // Wait a bit more than 0.2 secs (the duration of the tile fade-in)
      // to trigger a pruning.
      setTimeout(Util.bind(this._pruneTiles, this), 250);
    }
  }
}

L.TileLayer.prototype.createTile = function (coords, done) {
  const tileImage = document.createElement('img');

  // tileImage.addEventListener('load', event => {})
  DomEvent.on(tileImage, 'load', Util.bind(this._tileOnLoad, this, done, tileImage))
  DomEvent.on(tileImage, 'error', Util.bind(this._tileOnError, this, done, tileImage))

  tileImage.alt = '' // http://www.w3.org/TR/WCAG20-TECHS/H67
  tileImage.setAttribute('role', 'presentation') // https://www.w3.org/TR/wai-aria/roles#textalternativecomputation
  tileImage.src = this.getTileUrl(coords)
  return tileImage;
}

L.Map.prototype._handleDOMEvent = function (event) {
  if (!this._loaded || DomEvent.skipped(event)) return

  var type = event.type;

  if (type === 'mousedown' || type === 'keypress') {
    // prevents outline when clicking on keyboard-focusable element
    DomUtil.preventOutline(event.target || event.srcElement);
  }

  this._fireDOMEvent(event, type);
}


const map = L.map('mapid').setView([41.85, -87.64999999999998], 7)
const accessToken = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw'
const urlTemplate = `https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=${accessToken}`
const options = {
  minZoom:  3,
  maxZoom: 15,
  keepBuffer: 0, // default: 2
  id: 'mapbox.streets',
  zoomAnimation: false, // default: true
  zoomAnimationThreshold: 0, // default: 4
  fadeAnimation: false, // default: true
  detectRetina: false // automatically injects '@2x' into urlTemplate; default: false
}

L.tileLayer(urlTemplate, options).addTo(map)
