import { createSubtitlePhysicalFixture } from '../../../test/support/subtitle-track-physical-binding.fixture.js';
import { runProcess } from './infrastructure/ffmpeg-process.js';
import { validateAlignment } from './domain/alignment-contracts.js';
import { validateVideoRender } from './domain/video-render-contracts.js';

const ffmpeg = process.env.MKTAUTO_TEST_FFMPEG;
const ffprobe = process.env.MKTAUTO_TEST_FFPROBE;

it.skipIf(!ffmpeg || !ffprobe)(
  'explicit native QC records current handoff evidence atomically without fabricating historical timestamps',
  async () => {
    // Owned synthetic fixture and pinned alignment only; not commercial or acoustic acceptance.
    const runner = vi.fn(runProcess);
    const f = await createSubtitlePhysicalFixture(ffmpeg!, ffprobe!, runner);
    try {
      const alignment = validateAlignment(
        await f.flow.alignAudio(f.voice.voiceTrackId),
      );
      const subtitles = f.flow.subtitles(alignment.output.alignmentId) as {
        subtitleId: string;
      };
      const source = validateVideoRender(
        await f.flow.compose(f.input.compositionRequest),
      );
      const final = validateVideoRender(
        await f.flow.burn(source.videoRenderId, subtitles.subtitleId),
      );
      const before = Date.now();
      const report = (await f.flow.qc(final.videoRenderId)) as {
        reportId: string;
        result: string;
      };
      expect(report.result).toBe('PASS');
      const calls = runner.mock.calls.length;
      const evidence = f.flow.qcHandoffEvidence(final.videoRenderId)!;
      expect(evidence.reportId).toBe(report.reportId);
      expect(evidence.report.videoRenderContentHash).toBe(final.contentHash);
      expect(Date.parse(evidence.checkedAt)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(evidence.checkedAt)).toBeLessThanOrEqual(Date.now());
      expect(f.make().qcHandoffEvidence(final.videoRenderId)).toEqual(evidence);
      expect(runner.mock.calls.length).toBe(calls);
    } finally {
      await f.cleanup();
    }
  },
  120000,
);
