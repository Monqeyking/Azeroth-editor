import { useEffect, useRef } from 'react';

const TILE_WIDTH = 260;
const TILE_HEIGHT = 220;
const GAP = 14;
const LABEL_HEIGHT = 26;

export default function TextureWorkspaceCanvas({ tiles = [], activeKey = '', onSelect }) {
  const canvasRef = useRef(null);
  const layoutRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Keep the overview as a compact grid. The wrapper exposes one row and
    // lets the remaining rows be reached with vertical scrolling.
    const columns = Math.max(1, Math.min(3, tiles.length || 1));
    const rows = Math.max(1, Math.ceil(tiles.length / columns));
    canvas.width = columns * (TILE_WIDTH + GAP) + GAP;
    canvas.height = rows * (TILE_HEIGHT + LABEL_HEIGHT + GAP) + GAP;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#15161d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    layoutRef.current = [];
    tiles.forEach((tile, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = GAP + column * (TILE_WIDTH + GAP);
      const y = GAP + row * (TILE_HEIGHT + LABEL_HEIGHT + GAP);
      const image = tile.rgba;
      const scale = image?.width && image?.height ? Math.min(TILE_WIDTH / image.width, TILE_HEIGHT / image.height) : 1;
      const width = Math.max(1, Math.round((image?.width || TILE_WIDTH) * scale));
      const height = Math.max(1, Math.round((image?.height || TILE_HEIGHT) * scale));
      const imageX = x + Math.round((TILE_WIDTH - width) / 2);
      const imageY = y + LABEL_HEIGHT + Math.round((TILE_HEIGHT - height) / 2);
      const active = [tile.key, tile.selectionPath].some(value => String(value || '').toLowerCase() === String(activeKey || '').toLowerCase());
      layoutRef.current.push({ tile, x, y, width: TILE_WIDTH, height: TILE_HEIGHT + LABEL_HEIGHT });
      ctx.fillStyle = active ? '#263e70' : '#20212a';
      ctx.fillRect(x, y, TILE_WIDTH, TILE_HEIGHT + LABEL_HEIGHT);
      ctx.strokeStyle = active ? '#67a4ff' : '#454652';
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(x + .5, y + .5, TILE_WIDTH - 1, TILE_HEIGHT + LABEL_HEIGHT - 1);
      if (image?.data && image.width && image.height) {
        const temp = document.createElement('canvas');
        temp.width = image.width; temp.height = image.height;
        temp.getContext('2d').putImageData(image, 0, 0);
        ctx.drawImage(temp, imageX, imageY, width, height);
      } else {
        ctx.fillStyle = '#6b6d78';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Loading texture…', x + TILE_WIDTH / 2, imageY + 22);
      }
      ctx.fillStyle = '#f0f1f7';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(tile.label || tile.key || 'Texture', x + 8, y + 18);
    });
  }, [tiles, activeKey]);

  const handlePointerDown = event => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    const hit = layoutRef.current.find(item => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
    if (hit?.tile?.selectionPath) onSelect?.(hit.tile.selectionPath);
  };

  return <div className="tme-workspace-canvas-wrap"><canvas ref={canvasRef} className="tme-workspace-canvas" onPointerDown={handlePointerDown} /></div>;
}
