/**
 * A stand-in for `mapbox-gl` used by the preview specimens: no WebGL, no tiles, no token. It
 * implements only what `useMapboxMap`, `LiveMap` and `MapPinPicker` call (Map, Marker,
 * LngLatBounds), projects points linearly around the centre, and draws an attribution line
 * bottom-right, so a screenshot shows the pins, the controls and that nothing covers the
 * attribution. Never shipped to an app: only `*.preview.tsx` files import it.
 */

import type { MapboxModule } from '../map-engine.js';

type LngLat = [number, number];
type Handler = (event: object) => void;

class FakeLngLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  constructor(a: LngLat, b: LngLat) {
    this.west = Math.min(a[0], b[0]);
    this.east = Math.max(a[0], b[0]);
    this.south = Math.min(a[1], b[1]);
    this.north = Math.max(a[1], b[1]);
  }
  extend(p: LngLat): this {
    this.west = Math.min(this.west, p[0]);
    this.east = Math.max(this.east, p[0]);
    this.south = Math.min(this.south, p[1]);
    this.north = Math.max(this.north, p[1]);
    return this;
  }
  contains(): boolean {
    return true;
  }
}

class FakeMap {
  container: HTMLElement;
  center: LngLat;
  zoom: number;
  /** Pixels per degree. */
  scale = 60_000;
  markers = new Set<FakeMarker>();
  handlers = new Map<string, Set<Handler>>();
  constructor(options: { container: HTMLElement; center?: LngLat; zoom?: number }) {
    this.container = options.container;
    this.center = options.center ?? [-79.26, 43.73];
    this.zoom = options.zoom ?? 14;
    const attribution = document.createElement('div');
    attribution.textContent = '© Mapbox © OpenStreetMap';
    Object.assign(attribution.style, {
      position: 'absolute', right: '0', bottom: '0', padding: '2px 6px', fontSize: '11px',
      background: 'var(--hg-surface-raised)', color: 'var(--hg-text-secondary)', zIndex: '2',
    });
    this.container.appendChild(attribution);
    setTimeout(() => this.fire('load'), 0);
  }
  on(type: string, fn: Handler): this {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return this;
  }
  off(type: string, fn: Handler): this {
    this.handlers.get(type)?.delete(fn);
    return this;
  }
  fire(type: string): void {
    for (const fn of this.handlers.get(type) ?? []) fn({ type });
  }
  loaded(): boolean {
    return true;
  }
  remove(): void {
    this.container.replaceChildren();
  }
  resize(): void {}
  getZoom(): number {
    return this.zoom;
  }
  getBounds(): FakeLngLatBounds {
    return new FakeLngLatBounds(this.center, this.center);
  }
  zoomIn(): void {
    this.scale *= 2;
    this.layout();
  }
  zoomOut(): void {
    this.scale /= 2;
    this.layout();
  }
  easeTo(options: { center?: LngLat }): void {
    if (options.center) this.center = options.center;
    this.layout();
  }
  fitBounds(b: FakeLngLatBounds): void {
    this.center = [(b.west + b.east) / 2, (b.south + b.north) / 2];
    const w = this.container.clientWidth || 600;
    const h = this.container.clientHeight || 300;
    const span = Math.max((b.east - b.west) / (w * 0.6), ((b.north - b.south) * 1.38) / (h * 0.6), 1e-6);
    this.scale = 1 / span;
    this.layout();
  }
  project(p: LngLat): [number, number] {
    const w = this.container.clientWidth || 600;
    const h = this.container.clientHeight || 300;
    return [w / 2 + (p[0] - this.center[0]) * this.scale, h / 2 - (p[1] - this.center[1]) * this.scale * 1.38];
  }
  layout(): void {
    for (const m of this.markers) m.place();
  }
}

class FakeMarker {
  element: HTMLElement;
  map: FakeMap | null = null;
  lngLat: LngLat = [0, 0];
  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
    Object.assign(this.element.style, { position: 'absolute', transform: 'translate(-50%, -50%)', zIndex: '1' });
  }
  setLngLat(p: LngLat): this {
    this.lngLat = p;
    this.place();
    return this;
  }
  getLngLat(): { lng: number; lat: number } {
    return { lng: this.lngLat[0], lat: this.lngLat[1] };
  }
  addTo(map: FakeMap): this {
    this.map = map;
    map.markers.add(this);
    map.container.appendChild(this.element);
    this.place();
    return this;
  }
  getElement(): HTMLElement {
    return this.element;
  }
  on(): this {
    return this;
  }
  remove(): void {
    this.map?.markers.delete(this);
    this.element.remove();
  }
  place(): void {
    if (!this.map) return;
    const [x, y] = this.map.project(this.lngLat);
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }
}

/** `loadMapbox` for specimens: resolves at once with the stand-in engine. */
export const loadFakeMapbox = (): Promise<MapboxModule> =>
  Promise.resolve({
    default: { Map: FakeMap, Marker: FakeMarker, LngLatBounds: FakeLngLatBounds, accessToken: '' },
  } as unknown as MapboxModule);
