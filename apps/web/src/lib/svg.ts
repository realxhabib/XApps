/** Data URL for self-contained SVG markup (rendered via <img>, so scripts never run). */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
