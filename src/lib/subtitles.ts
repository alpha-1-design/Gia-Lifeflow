/** SRT / VTT subtitle parsing. Both formats share "HH:MM:SS,mmm --> …" cue lines. */

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export function cueTime(t: string): number {
  const seg = t.trim().replace(",", ".").split(":").map((x) => Number(x));
  if (seg.length >= 3) return seg[0] * 3600 + seg[1] * 60 + (seg[2] || 0);
  return seg[0] * 60 + (seg[1] || 0);
}

export function parseSubs(text: string): SubtitleCue[] {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const tl = lines.findIndex((l) => l.includes("-->"));
    if (tl < 0) continue;
    const [a, b] = lines[tl].split("-->");
    const start = cueTime(a);
    const end = cueTime(b);
    const content = lines.slice(tl + 1).join("\n").trim();
    if (content && start < end) cues.push({ start, end, text: content });
  }
  return cues;
}
