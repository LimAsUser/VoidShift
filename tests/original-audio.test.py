"""Focused acceptance of the phase-one audio files, not the game test suite."""
import json
from pathlib import Path
import subprocess
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'design/audio/original-v1'


class OriginalAudioTests(unittest.TestCase):
    def test_six_groups_and_all_individual_variations_exist(self):
        self.assertTrue((BANK / 'manifest.json').is_file(), 'phase-one sound bank has not been generated')
        manifest = json.loads((BANK / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['source'], 'original-local-procedural')
        self.assertEqual(manifest['stage'], 'audition-awaiting-approval')
        self.assertEqual(len(manifest['auditions']), 6)
        self.assertEqual(set(item['group'] for item in manifest['clips']),
                         {'hunter', 'monster', 'heavy', 'weapons', 'ui', 'terminal'})
        self.assertEqual(len(manifest['clips']), 46)
        for item in manifest['clips'] + manifest['auditions']:
            self.assertTrue((BANK / item['file']).is_file(), item['file'])
        hunter = next(item for item in manifest['auditions'] if item['group'] == 'hunter')
        gaps = np.diff([event['at'] for event in hunter['events']])
        self.assertTrue(np.all((gaps >= .9 - 1e-6) & (gaps <= 1.1 + 1e-6)))
        heavy_charge = next(item for item in manifest['clips'] if item['cue'] == 'heavy-windup')
        self.assertAlmostEqual(heavy_charge['duration'], 2, places=3)
        for cue in ['hunter-step', 'monster-step', 'heavy-step', 'pistol-shot', 'smg-shot', 'shotgun-shot', 'revolver-shot', 'ui-click', 'terminal-key']:
            variants = [item for item in manifest['clips'] if item['cue'] == cue]
            self.assertGreaterEqual(len(variants), 3, cue)
            self.assertEqual(len(set(item['pcm_sha256'] for item in variants)), len(variants), cue)

    def test_every_mp3_decodes_with_headroom_and_a_prompt_start(self):
        self.assertTrue((BANK / 'manifest.json').is_file())
        manifest = json.loads((BANK / 'manifest.json').read_text(encoding='utf-8'))
        for item in manifest['clips'] + manifest['auditions']:
            with self.subTest(file=item['file']):
                raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(BANK / item['file']),
                                      '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'],
                                     check=True, capture_output=True).stdout
                audio = np.frombuffer(raw, dtype='<f4')
                self.assertTrue(np.isfinite(audio).all())
                peak = float(np.max(np.abs(audio)))
                self.assertGreater(peak, .02)
                self.assertLess(peak, .95, 'MP3 overshoot should retain headroom')
                self.assertAlmostEqual(len(audio) / 48000, item['duration'], delta=.04)
                if 'cue' in item:
                    self.assertLess(np.argmax(np.abs(audio) > peak * .01) / 48000, .03,
                                    'one-shot has excessive leading silence')
                self.assertLess(float(np.sqrt(np.mean(audio[-240:] ** 2))), .01,
                                'audible abrupt cut at the end')

    def test_audition_timelines_reference_real_clips_and_cover_the_required_cues(self):
        self.assertTrue((BANK / 'manifest.json').is_file())
        manifest = json.loads((BANK / 'manifest.json').read_text(encoding='utf-8'))
        by_id = {item['id']: item for item in manifest['clips']}
        for demo in manifest['auditions']:
            for event in demo['events']:
                self.assertIn(event['clip'], by_id)
                self.assertGreaterEqual(event['at'], 0)
                self.assertLessEqual(event['at'] + by_id[event['clip']]['duration'], demo['duration'] + .001)
        weapons = next(item for item in manifest['auditions'] if item['group'] == 'weapons')
        self.assertEqual({by_id[event['clip']]['cue'] for event in weapons['events']},
                         {'pistol-shot', 'smg-shot', 'shotgun-shot', 'revolver-shot'})


if __name__ == '__main__':
    unittest.main()
