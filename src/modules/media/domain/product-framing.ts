export const PRODUCT_FRAMING_POLICY = 'product-contain/1.0.0';
export const PRODUCT_FRAMING_STRATEGY = 'CONTAIN_9_16';
// Keep the complete source above the caption band. Neutral padding never covers it.
export const PRODUCT_VIEWPORT = Object.freeze({
  width: 1080,
  height: 1400,
  top: 160,
});
export const PRODUCT_CAPTION_STYLE =
  'Fontsize=54,MarginL=108,MarginR=162,MarginV=220,Alignment=2';
export function productContainFilter() {
  return 'scale=1080:1400:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=1080:1400:(ow-iw)/2:(oh-ih)/2:color=0x101010,pad=1080:1920:0:160:color=0x101010';
}
