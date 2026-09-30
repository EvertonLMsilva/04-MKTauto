import { VideoComposer } from "../src/video-composer.js";

export class DeterministicVideoComposer extends VideoComposer {
  constructor(output = {}) { super(); this.calls = []; this.output = Object.freeze({ durationMilliseconds: 1000, containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920, contentHash: "f".repeat(64), logicalReference: "render:fake_output", ...output }); }
  async compose(input) { this.calls.push(structuredClone(input)); return this.output; }
}
