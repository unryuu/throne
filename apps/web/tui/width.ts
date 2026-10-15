/** Terminal cell width of one grapheme; ambiguous symbols stay narrow. */
export function displayWidth(grapheme: string): number {
  if (/\p{Emoji_Presentation}|\uFE0F/u.test(grapheme)) return 2;
  let width = 0;
  for (const char of grapheme) {
    if (/\p{Mark}|\p{Default_Ignorable_Code_Point}/u.test(char)) continue;
    const c = char.codePointAt(0)!;
    if (c < 32 || (c >= 0x7f && c < 0xa0)) continue;
    const wide =
      c >= 0x1100 &&
      (c <= 0x115f ||
        c === 0x2329 ||
        c === 0x232a ||
        (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe10 && c <= 0xfe19) ||
        (c >= 0xfe30 && c <= 0xfe6f) ||
        (c >= 0xff01 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6) ||
        (c >= 0x16fe0 && c <= 0x18dff) ||
        (c >= 0x1aff0 && c <= 0x1b2ff) ||
        (c >= 0x1f200 && c <= 0x1f251) ||
        (c >= 0x20000 && c <= 0x3fffd));
    width += wide ? 2 : 1;
  }
  return width;
}
