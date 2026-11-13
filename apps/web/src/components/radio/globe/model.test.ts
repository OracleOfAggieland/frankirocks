import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Station } from "../../../ui/radio/types";
import { LIGHT_LIFT, type MapCanvas, buildGlobe } from "./model";
import { latLonToVec } from "./motion";
import { MAP_H, MAP_W, type MapContext } from "./texture";

const station = (id: string, city: string, lat: number, lon: number, rock = false): Station => ({
  id,
  name: `${city} FM`,
  city,
  country: "Somewhere",
  lat,
  lon,
  url: `https://example.test/${id}.mp3`,
  rock,
});

const FIXTURE: readonly Station[] = [
  station("sp", "Sao Paulo", -23.55, -46.63, true),
  station("pa", "Paris", 48.86, 2.35),
  station("na", "Nairobi", -1.29, 36.82),
  station("sy", "Sydney", -33.87, 151.21, true),
];

const noop = () => {};
/** A canvas with a 2D context that draws nothing. */
function fakeCanvas(): MapCanvas & { drawn: number } {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : noop),
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  }) as unknown as MapContext;
  const c = {
    width: 0,
    height: 0,
    drawn: 0,
    getContext: () => {
      c.drawn++;
      return ctx;
    },
  };
  return c;
}
const PALETTE = { sea: "a", land: "b", coast: "c", thread: "d" };

describe("buildGlobe", () => {
  it("draws its map once on a canvas of the map's size, with no WebGL", () => {
    const canvas = fakeCanvas();
    const m = buildGlobe(FIXTURE, () => canvas, PALETTE);
    expect(canvas.drawn).toBe(1);
    expect([canvas.width, canvas.height]).toEqual([MAP_W, MAP_H]);
    expect(m.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.map.wrapS).toBe(THREE.RepeatWrapping);
    m.dispose();
  });

  it("has one light and one glow per station, just above the unit sphere", () => {
    const m = buildGlobe(FIXTURE, fakeCanvas, PALETTE);
    expect(m.lights).toHaveLength(FIXTURE.length);
    expect(m.glows).toHaveLength(FIXTURE.length);
    FIXTURE.forEach((s, i) => {
      expect(m.positions[i]!.length()).toBeCloseTo(1, 9);
      expect(m.lights[i]!.position.length()).toBeCloseTo(LIGHT_LIFT, 9);
      expect(m.positions[i]!.toArray()).toEqual(latLonToVec(s.lat, s.lon));
      expect(m.lights[i]!.userData.stationId).toBe(s.id);
    });
    m.dispose();
  });

  it("maps the texture so a station's light sits over its own place on the map", () => {
    const m = buildGlobe(FIXTURE, fakeCanvas, PALETTE);
    const geo = m.globe.geometry;
    const pos = geo.getAttribute("position");
    const uv = geo.getAttribute("uv");
    const v = new THREE.Vector3();
    for (const s of FIXTURE) {
      const p = new THREE.Vector3(...latLonToVec(s.lat, s.lon));
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const d = v.fromBufferAttribute(pos, i).distanceTo(p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      // The nearest vertex's u and v read back as nearly the station's own longitude and latitude.
      const lon = uv.getX(best) * 360 - 180;
      const lat = uv.getY(best) * 180 - 90;
      expect(Math.abs(((lon - s.lon + 540) % 360) - 180)).toBeLessThan(6);
      expect(Math.abs(lat - s.lat)).toBeLessThan(4);
    }
    m.dispose();
  });

  it("moves the marker to the tuned station, hides that light, and grows a hovered one", () => {
    const m = buildGlobe(FIXTURE, fakeCanvas, PALETTE);
    expect(m.marker.group.visible).toBe(false);
    m.setTuned(1);
    expect(m.marker.group.visible).toBe(true);
    expect(m.marker.group.position.equals(m.positions[1]!)).toBe(true);
    expect(m.lights[1]!.visible).toBe(false);
    // The marker's +Z is the outward normal: the antenna points up off the surface.
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(m.marker.group.quaternion);
    expect(up.distanceTo(m.positions[1]!)).toBeLessThan(1e-9);
    expect(m.marker.rings).toHaveLength(3);
    m.setHover(2);
    expect(m.lights[2]!.scale.x).toBeGreaterThan(1);
    m.setHover(-1);
    expect(m.lights[2]!.scale.x).toBe(1);
    m.setTuned(-1);
    expect(m.marker.group.visible).toBe(false);
    expect(m.lights[1]!.visible).toBe(true);
    m.dispose();
  });

  it("frees every geometry, material and texture, and can be disposed twice", () => {
    const m = buildGlobe(FIXTURE, fakeCanvas, PALETTE);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    m.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) geos.add((o as THREE.Mesh).geometry);
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) mats.add((o as THREE.Mesh).material as THREE.Material);
    });
    const textures = new Set<THREE.Texture>([m.map]);
    for (const mat of mats) {
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) textures.add(map);
    }
    let freed = 0;
    for (const x of [...geos, ...mats, ...textures]) x.addEventListener("dispose", () => freed++);
    m.dispose();
    expect(freed).toBe(geos.size + mats.size + textures.size);
    expect(textures.size).toBe(2);
    expect(() => m.dispose()).not.toThrow();
  });
});
