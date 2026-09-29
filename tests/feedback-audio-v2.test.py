"""Asset checks only; does not run or change the game."""
import json
import subprocess
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'design/audio/feedback-v2'


def decode(file):
    return np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file),
        '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], capture_output=True, check=True).stdout, dtype='<f4')


class FeedbackV2Tests(unittest.TestCase):
    def manifest(self):
        self.assertTrue((BANK / 'manifest.json').is_file(), 'V2 audition bank not yet generated')
        return json.loads((BANK / 'manifest.json').read_text(encoding='utf-8'))

    def test_key_groups_and_lifecycle_cues_exist_without_runtime_integration(self):
        data = self.manifest()
        self.assertEqual(data['status'], 'candidate-awaiting-listening-approval')
        self.assertEqual(data['downloads'], [])
        self.assertEqual(len(data['auditions']), 10)
        cues = {item['cue'] for item in data['clips']}
        self.assertTrue({'pistol-shot', 'smg-shot', 'revolver-shot', 'shotgun-shot',
            'hunter-step', 'hunter-chase', 'hunter-attack', 'hunter-hit', 'hunter-death', 'hunter-revive',
            'monster-step', 'monster-attack', 'monster-hit', 'monster-dormant', 'monster-wake',
            'heavy-step', 'heavy-windup', 'heavy-charge-start', 'heavy-wall-impact', 'heavy-death',
            'terminal-success', 'terminal-all-confirm', 'power-down', 'extraction-ready',
            'victory-impact', 'failure-impact'}.issubset(cues))
        self.assertNotIn('monster-death', cues)
        for cue in ['pistol-shot', 'smg-shot', 'revolver-shot', 'shotgun-shot', 'hunter-step', 'monster-step', 'heavy-step']:
            variants = [item for item in data['clips'] if item['cue'] == cue]
            self.assertGreaterEqual(len(variants), 3)
            self.assertEqual(len({item['pcm_sha256'] for item in variants}), len(variants))

    def test_real_mp3_decoding_has_safe_peaks_durations_and_clean_boundaries(self):
        data = self.manifest()
        for item in data['clips'] + data['auditions']:
            with self.subTest(file=item['file']):
                audio = decode(BANK / item['file'])
                self.assertTrue(np.isfinite(audio).all())
                peak = np.max(np.abs(audio))
                self.assertGreater(peak, .01)
                self.assertLess(peak, .95)
                self.assertAlmostEqual(len(audio) / 48000, item['duration'], delta=.04)
                self.assertLess(np.sqrt(np.mean(audio[-240:] ** 2)), .012)
                if item.get('one_shot'):
                    self.assertLess(np.argmax(np.abs(audio) > peak * .01) / 48000, .03)

    def test_weapon_shapes_differ_at_matched_peaks_and_smg_tail_is_bounded(self):
        data = self.manifest()
        peaks, bass = {}, {}
        for weapon in ['smg', 'pistol', 'revolver', 'shotgun']:
            item = next(item for item in data['clips'] if item['cue'] == weapon + '-shot')
            audio = decode(BANK / item['file'])
            peaks[weapon] = 20 * np.log10(np.max(np.abs(audio)))
            spectrum = np.abs(np.fft.rfft(audio)) ** 2
            f = np.fft.rfftfreq(len(audio), 1 / 48000)
            bass[weapon] = np.sum(spectrum[(f >= 30) & (f <= 220)]) / np.sum(spectrum)
            if weapon == 'smg':
                self.assertLessEqual(item['duration'], .16)
        self.assertLess(max(peaks.values()) - min(peaks.values()), 1.5, 'weapon identity must not be merely louder gain')
        self.assertGreater(bass['shotgun'], bass['revolver'])
        self.assertGreater(bass['revolver'], bass['pistol'])
        self.assertGreater(bass['pistol'], bass['smg'])

    def test_sequences_keep_authoring_timing_and_reference_independent_clips(self):
        data = self.manifest()
        by_id = {item['id']: item for item in data['clips']}
        for demo in data['auditions']:
            for event in demo['events']:
                self.assertIn(event['clip'], by_id)
                self.assertGreaterEqual(event['at'], 0)
        victory = next(demo for demo in data['auditions'] if demo['id'] == '07-victory')
        failure = next(demo for demo in data['auditions'] if demo['id'] == '08-failure')
        self.assertEqual(victory['duration'], 6.5)
        self.assertEqual(failure['duration'], 2.5)
        self.assertEqual(next(event['at'] for event in victory['events'] if event['clip'].startswith('victory-impact')), 1.8)
        single = next(demo for demo in data['auditions'] if demo['id'] == '05-terminal-single')
        self.assertEqual(next(event['at'] for event in single['events'] if event['clip'].startswith('terminal-success')), .15)
        stress = json.loads((BANK / 'qa.json').read_text(encoding='utf-8'))['offline_smg_stress']
        self.assertEqual(stress['shooters'], 4)
        self.assertLessEqual(stress['maximum_concurrent_shots'], 8)
        self.assertLess(stress['decoded_peak'], .95)


if __name__ == '__main__':
    unittest.main()
