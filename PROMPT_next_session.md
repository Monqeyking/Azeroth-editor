# Next Session Prompt — 3D Editor: echte terrain texturen

## Context

De 3D editor (`/editor3d`) heeft nu naadloos terrain via AzerothCore `.map` files (V9/V8 absolute hoogtes). Terrain gaps zijn opgelost. WDL-mesh is verwijderd. Tile streaming: TILE_RADIUS=4 (9×9 tiles), MAX_TILES=200.

Het terrain toont nu vertex-kleuring op basis van hoogte (groen/grijs/wit/blauw). De taak is om de **echte WoW terrain texturen** te laden en te renderen via een splatmap-systeem.

---

## Hoe WoW terrain texturen werken (ADT formaat)

Terrain textures staan in de **ADT bestanden** (MPQ, niet de `.map` server files). Per tile:

### MTEX chunk (reversed magic `'XETM'`)
- Lijst van null-terminated BLP texture-paden
- Voorbeeld: `TILESET\Terrain\Ashenvale\AshenvaleDirt01.blp`
- Maximaal ~16 unieke textures per tile

### Per MCNK chunk (256 per tile, 16×16 grid):
**MCLY sub-chunk** (reversed `'YLCM'`) — offset staat in MCNK header op byte 60 (`ds + 60`):
- Array van max 4 records, elk 16 bytes:
  ```
  uint32 textureId    // index in MTEX lijst
  uint32 flags        // 0x200 = alpha map compressed (RLE)
  uint32 offsetMCAL   // byte-offset in MCAL chunk
  uint32 effectId
  ```

**MCAL sub-chunk** (reversed `'LACM'`) — offset staat in MCNK header op byte 64 (`ds + 64`):
- Alpha map data voor layer 1, 2, 3 (layer 0 heeft geen alpha = altijd volledig zichtbaar)
- Ongecomprimeerd: 4096 bytes (64×64, 1 byte per texel)
- Gecomprimeerd (RLE, flag 0x200 in MCLY):
  ```js
  while (outPos < 4096) {
    const header = buf[pos++];
    const fill  = (header & 0x80) !== 0;
    const count = (header & 0x7F) + 1;
    if (fill) {
      const val = buf[pos++];
      for (let i = 0; i < count && outPos < 4096; i++) out[outPos++] = val;
    } else {
      for (let i = 0; i < count && outPos < 4096; i++) out[outPos++] = buf[pos++];
    }
  }
  ```

### WoW blending logica (4 lagen):
```glsl
vec4 color = texture2D(tex0, worldUv * tileFreq);
color = mix(color, texture2D(tex1, worldUv * tileFreq), alpha1);
color = mix(color, texture2D(tex2, worldUv * tileFreq), alpha2);
color = mix(color, texture2D(tex3, worldUv * tileFreq), alpha3);
```
Layer 0 = base (altijd zichtbaar). Layer 1-3 worden er overheen geblend via alpha maps.

---

## Plan van aanpak

### Stap 1 — Nieuwe IPC: `adt:getTileTextureLayers`

In `electron/main.js`, na de bestaande ADT terrain handlers:

```js
ipcMain.handle('adt:getTileTextureLayers', async (_, { mapName, tiles }) => {
  // Leest MTEX + MCLY + MCAL uit ADT (van MPQ, vereist worldmapMpqPath)
  // Returns per tile:
  // {
  //   tileX, tileY,
  //   texturePaths: string[],         // unieke BLP paden voor deze tile
  //   chunks: Array(256) van {
  //     ix, iy,
  //     layers: Array(1-4) van {
  //       textureIdx: number,          // index in texturePaths
  //       alphaMap: Uint8Array(4096)   // 64×64 decoded alpha (null voor layer 0)
  //     }
  //   }
  // }
});
```

Gebruik `getMpqReader().readAdtBuffer()` (al aanwezig). Parse dezelfde MCNK loop als `parseAdt()` maar lees nu MCLY + MCAL i.p.v. MCVT.

**Valkuil:** offsMCLY in MCNK header zit op `ds + 60`, offsMCAL op `ds + 64` (relatieve offsets binnen MCNK data). Valideer magics: MCLY = `'YLCM'`, MCAL = `'LACM'`.

### Stap 2 — Splatmap bouwen in de renderer

Per tile: één **1024×1024 RGBA** `THREE.DataTexture`:
- 16 chunks × 64 pixels = 1024 per richting
- Chunk `(ix, iy)` bezet pixels `[ix*64 .. ix*64+63, iy*64 .. iy*64+63]`
- R = alpha layer 1, G = layer 2, B = layer 3

```js
const splatData = new Uint8Array(1024 * 1024 * 4);
for (const { ix, iy, layers } of chunks) {
  for (let py = 0; py < 64; py++) {
    for (let px = 0; px < 64; px++) {
      const si = ((iy * 64 + py) * 1024 + (ix * 64 + px)) * 4;
      for (let l = 1; l < layers.length; l++) {
        splatData[si + (l - 1)] = layers[l].alphaMap[py * 64 + px];
      }
    }
  }
}
```

### Stap 3 — ShaderMaterial

```glsl
// vertex:
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv; vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment:
uniform sampler2D splatmap;
uniform sampler2D tex0, tex1, tex2, tex3;
uniform int numLayers;
uniform float tileFreq;  // default 8.0

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vec2 texUv = vUv * tileFreq;
  vec4 splat = texture2D(splatmap, vUv);
  vec4 color = texture2D(tex0, texUv);
  if (numLayers > 1) color = mix(color, texture2D(tex1, texUv), splat.r);
  if (numLayers > 2) color = mix(color, texture2D(tex2, texUv), splat.g);
  if (numLayers > 3) color = mix(color, texture2D(tex3, texUv), splat.b);
  float light = 0.6 + 0.4 * max(dot(normalize(vNormal), normalize(vec3(0.5, 1.0, 0.3))), 0.0);
  gl_FragColor = vec4(color.rgb * light, 1.0);
}
```

### Stap 4 — BLP textures laden

Gebruik de bestaande `dbc:readBlpTextures` IPC (batch loader, gecached). De paths uit MTEX zijn Windows-stijl (`TILESET\Terrain\...`) — de MPQ reader handelt dit al af.

Module-level `Map<blpPath, THREE.Texture>` cache in de renderer voorkomt dubbel uploaden (dezelfde `Grass.blp` wordt door honderden tiles gedeeld).

### Stap 5 — Integratie in TerrainTile

`TerrainTile` ontvangt een extra prop `textureLayers`:
```jsx
<TerrainTile
  tile={tile}
  textureUrl={tileTextures[key]}       // bestaand: minimap BLP overlay
  textureLayers={textureLayers[key]}   // nieuw: {texturePaths, chunks}
/>
```

Als `textureLayers` aanwezig → ShaderMaterial met splatmap.
Als niet → fallback naar vertex-kleur (bestaand gedrag).

---

## Codebase referentie

- `electron/main.js` ~regel 1655: `parseAdt()` — MCIN + MCVT parser. MCLY+MCAL toevoegen in dezelfde MCNK loop.
- `electron/main.js` ~regel 1771: `adt:getTerrain` handler — patroon voor nieuwe handler.
- `electron/main.js` ~regel 1861: `adt:getTileTextures` — minimap BLP loader, zelfde MPQ patroon.
- `src/components/editor3d/Editor3DScene.jsx` ~regel 140: `TerrainTile` — hier ShaderMaterial.
- `src/lib/blpBatchLoader.js` — debounced BLP batch loader.
- `src/lib/useBlpTexture.js` — hook voor BLP textures, patroon voor terrain texture cache.

---

## Volgorde

1. `parseAdtTextureLayers(buf)` in main.js (MTEX + MCLY + MCAL per chunk)
2. `adt:getTileTextureLayers` IPC handler
3. Texture loading effect in `Editor3DPage.jsx` (parallel aan getTileTextures na terrain batch)
4. `buildSplatmap(chunks)` util in `Editor3DScene.jsx`
5. ShaderMaterial in `TerrainTile` met fallback
6. Module-level Three.js texture cache per BLP path

---

## Verificatie

- Grass/dirt/rock texturen zichtbaar op terrain
- Vloeiende overgangen via alpha blending
- Geen extra load: texture cache voorkomt dubbel laden van gedeelde BLPs
- Fallback naar vertex-kleuring als worldmapMpqPath niet ingesteld is
