"""Offline VOID SHIFT audition bank. Uses existing NumPy and local FFmpeg only.

No input recordings, downloads, generated speech, or game integration. These
are procedural design candidates awaiting human listening approval.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import wave
import zlib

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'design/audio/original-v1'
MASTERS = ROOT / '.sites-runtime/audio-original-v1/masters'
RATE = 48000
VERSION = 'original-v1'


def clock(seconds):
    return np.arange(round(seconds * RATE), dtype=np.float64) / RATE


def noise(rng, seconds, low=40, high=8000):
    """Broad, smoothly colored noise; filters are offline FFT spectral curves."""
    count = round(seconds * RATE)
    size = 1 << (count - 1).bit_length()
    freqs = np.fft.rfftfreq(size, 1 / RATE)
    spectrum = np.fft.rfft(rng.standard_normal(size))
    shape = (freqs / np.maximum(low, freqs)) ** 2 / np.sqrt(1 + (freqs / high) ** 6)
    signal = np.fft.irfft(spectrum * shape, size)[:count]
    return signal / max(.001, float(np.sqrt(np.mean(signal * signal))))


def add(target, source, at=0, gain=1):
    start = round(at * RATE)
    count = min(len(source), len(target) - start)
    if count > 0:
        target[start:start + count] += source[:count] * gain


def metal(rng, seconds, frequencies, decay=.2):
    t = clock(seconds)
    signal = np.zeros_like(t)
    for index, frequency in enumerate(frequencies):
        f = frequency * rng.uniform(.97, 1.03)
        envelope = (1 - np.exp(-t / .0008)) * np.exp(-t / (decay / (1 + f / 1600)))
        signal += np.sin(2 * np.pi * f * t + rng.uniform(-.7, .7)) * envelope / (1 + index) ** .8
    return signal


def hit(rng, seconds, weight, grit, decay=.10):
    t = clock(seconds)
    front = (1 - np.exp(-t / .0005))
    body = noise(rng, seconds, 25, weight * 3) * np.exp(-t / decay) * front
    crack = noise(rng, seconds, 700, grit) * np.exp(-t / .013) * front
    return body * .63 + crack * .13


def scrape(rng, seconds, low=700, high=5400):
    t = clock(seconds)
    knots = np.arange(0, seconds + .03, .013)
    pressure = np.interp(t, knots, rng.uniform(.04, 1, len(knots))) ** 1.45
    grip = (.48 + .52 * np.sin(2 * np.pi * (79 * t + 17 * t * t))) ** 2
    envelope = (1 - np.exp(-t / .006)) * np.exp(-t / (seconds / 2.7))
    signal = noise(rng, seconds, low, high) * (pressure + .35 * grip) * envelope
    for at in [0, .041, .093]:
        add(signal, metal(rng, min(.14, seconds), [980, 1733, 2987, 4703], .036), at, .045)
    return signal


def finish(signal, peak=None):
    signal = np.asarray(signal, dtype=np.float64).copy()
    signal -= signal.mean()
    # Zero DC/subsonic drift without adding artificial long reverb.
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1 / RATE)
    spectrum *= freqs / np.sqrt(freqs * freqs + 25 ** 2)
    signal = np.fft.irfft(spectrum, len(signal))
    start = min(round(.0007 * RATE), len(signal))
    end = min(round(.024 * RATE), len(signal))
    signal[:start] *= np.linspace(0, 1, start)
    signal[-end:] *= np.linspace(1, 0, end)
    maximum = float(np.max(np.abs(signal)))
    if maximum < 1e-8:
        raise ValueError('Silent audio recipe')
    if peak is not None:
        signal *= peak / maximum
    elif maximum > .65:
        signal *= .65 / maximum
    return signal.astype(np.float32)


def hunter_step(rng):
    signal = hit(rng, .88, 125, 5200, .065)
    add(signal, metal(rng, .75, [91, 157, 269, 463, 827, 1391], .12), .005, .16)
    add(signal, scrape(rng, .26, 470, 6200), rng.uniform(.029, .042), .52)
    add(signal, hit(rng, .24, 190, 5100, .025), .071, .09)
    add(signal, noise(rng, .40, 55, 290) * np.exp(-clock(.40) / .14), .020, .08)
    return finish(signal, .48)


def monster_step(rng):
    signal = np.zeros(round(.64 * RATE))
    for index, at in enumerate([0, .038, .084, .143]):
        add(signal, hit(rng, .17, 210, 6800, .026), at + (rng.uniform(-.005, .005) if index else 0), .22)
    add(signal, scrape(rng, .37, 800, 7200), .025, .36)
    add(signal, noise(rng, .45, 85, 570) * np.exp(-clock(.45) / .1), 0, .16)
    return finish(signal, .32)


def monster_hit(rng):
    t = clock(.49)
    signal = hit(rng, .49, 135, 4200, .055)
    texture = noise(rng, .49, 140, 2700) * np.exp(-t / .085) * (.6 + .4 * np.sin(2 * np.pi * 97 * t))
    add(signal, texture, .011, .24)
    add(signal, metal(rng, .28, [237, 487, 913, 1739], .04), .003, .12)
    return finish(signal, .44)


def heavy_step(rng):
    signal = hit(rng, 1.03, 76, 3100, .11)
    add(signal, metal(rng, .85, [51, 88, 143, 229, 383, 617], .20), .008, .3)
    add(signal, scrape(rng, .19, 230, 3200), .038, .20)
    for at, gain in [(.042, .09), (.096, .055), (.16, .025)]:
        add(signal, metal(rng, .23, [347, 641, 1097, 1891], .055), at, gain)
    return finish(signal, .58)


def heavy_windup(rng):
    t = clock(2)
    rise = .025 + .16 * (t / 2) ** 1.35
    signal = noise(rng, 2, 45, 420) * rise
    signal += noise(rng, 2, 300, 2900) * rise * (.4 + .6 * np.sin(2 * np.pi * (21 * t + 9 * t * t)) ** 2)
    add(signal, hit(rng, .28, 82, 2800, .065), 0, .65)
    for index, at in enumerate([.08, .37, .66, .98, 1.25, 1.49, 1.70]):
        add(signal, scrape(rng, .24, 230, 3400), at, .13 + index * .025)
        add(signal, metal(rng, .24, [83, 191, 457, 877], .085), at, .045)
    signal[-round(.13 * RATE):] *= np.linspace(1, .04, round(.13 * RATE))
    return finish(signal, .48)


def heavy_impact(rng):
    signal = hit(rng, 1.42, 83, 6500, .135)
    add(signal, metal(rng, 1.3, [47, 79, 127, 211, 353, 659, 1193], .26), .003, .44)
    add(signal, scrape(rng, .34, 440, 6400), .028, .37)
    for at, gain in [(.068, .20), (.16, .10), (.28, .045), (.39, .02)]:
        add(signal, metal(rng, .28, [281, 593, 1063, 1847], .060), at, gain)
    return finish(signal, .64)


GUNS = {
    'pistol': (.46, 180, .040, 7200, .16, .011),
    'smg': (.27, 255, .024, 6400, .12, .009),
    'shotgun': (.73, 92, .085, 9000, .29, .020),
    'revolver': (.62, 139, .062, 8500, .23, .014),
}


def gunshot(rng, weapon):
    seconds, weight, body_decay, edge, deck, crack_decay = GUNS[weapon]
    t = clock(seconds)
    attack = 1 - np.exp(-t / .00025)
    signal = .60 * noise(rng, seconds, 35, weight * 5) * np.exp(-t / body_decay) * attack
    signal += .24 * noise(rng, seconds, 1000, edge) * np.exp(-t / crack_decay) * attack
    signal += .055 * noise(rng, seconds, 90, 2200) * np.exp(-t / (body_decay * 2)) * attack
    add(signal, metal(rng, seconds * .7, [weight, weight * 1.63, weight * 2.71], body_decay), .003, deck)
    add(signal, metal(rng, .09, [990, 1777, 3191], .016), .035 if weapon != 'smg' else .019, .035)
    return finish(signal, .61 if weapon in ['shotgun', 'revolver'] else .55)


def interface(rng, cue, variant=0):
    durations = {'ui-click': .12, 'ui-confirm': .28, 'ui-cancel': .24, 'ui-error': .28,
                 'terminal-key': .17, 'terminal-error': .30, 'terminal-success': .82, 'terminal-shock': .62}
    seconds = durations[cue]
    signal = np.zeros(round(seconds * RATE))
    add(signal, hit(rng, min(seconds, .1), 390, 3900, .008), 0, .22)
    if cue == 'terminal-shock':
        t = clock(seconds)
        gates = np.maximum(0, np.sin(2 * np.pi * (73 * t + 27 * t * t))) ** .4
        signal += noise(rng, seconds, 120, 8200) * (.13 + .55 * gates) * np.exp(-t / .14)
        for at in [.004, .052, .123, .215]:
            add(signal, hit(rng, .14, 240, 10500, .018), at, .45)
        return finish(signal, .49)
    if cue == 'ui-click':
        add(signal, metal(rng, .12, [670, 1193, 2513], .015), 0, .16)
    elif cue in ['ui-error', 'terminal-error']:
        for at in [0, .095]:
            n = min(.16, seconds - at)
            t = clock(n)
            buzz = np.tanh(1.8 * np.sin(2 * np.pi * (240 if cue == 'ui-error' else 170) * t))
            add(signal, buzz * (1 - np.exp(-t / .002)) * np.exp(-t / .031), at, .055)
    elif cue == 'terminal-success':
        for at, frequencies in [(0, [280, 593]), (.17, [470, 1069]), (.34, [740, 1579])]:
            add(signal, metal(rng, .43, frequencies, .09), at, .09)
        t = clock(.62)
        add(signal, noise(rng, .62, 450, 2900) * np.sin(np.pi * t / .62) ** 2 * np.exp(-t / .28), .025, .055)
    else:
        start = {'ui-confirm': 870, 'ui-cancel': 710, 'terminal-key': 690 + variant * 100}[cue]
        end = start + (180 if cue == 'ui-confirm' else -170 if cue == 'ui-cancel' else 0)
        t = clock(seconds)
        carrier = np.sin(2 * np.pi * (start * t + (end - start) * t * t / (2 * seconds)))
        signal += carrier * (1 - np.exp(-t / .003)) * np.exp(-t / .045) * .06
    return finish(signal, .21 if cue.startswith('ui-') else .27)


def write_mp3(name, audio, relative, records, **metadata):
    wav_path = MASTERS / (name + '.wav')
    mp3_path = OUTPUT / relative
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(audio, -1, 1) * 32767).round().astype('<i2').tobytes()
    with wave.open(str(wav_path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(pcm)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav_path), '-map_metadata', '-1',
                    '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', str(RATE), '-ac', '1',
                    '-metadata', f'title=VOID SHIFT {name} original audition v1', str(mp3_path)], check=True)
    records.append({'id': name, 'file': relative, 'duration': round(len(audio) / RATE, 6),
                    'sample_rate': RATE, 'channels': 1, 'loop': False,
                    'pcm_sha256': hashlib.sha256(pcm).hexdigest(), **metadata})


def verify(manifest):
    results = []
    for item in manifest['clips'] + manifest['auditions']:
        file = OUTPUT / item['file']
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-f', 'f32le', '-ac', '1',
                              '-ar', str(RATE), 'pipe:1'], check=True, capture_output=True).stdout
        decoded = np.frombuffer(raw, dtype='<f4')
        peak = float(np.max(np.abs(decoded)))
        active = np.abs(decoded) > peak * .01
        leading = int(np.argmax(active)) / RATE
        result = {'file': item['file'], 'duration': len(decoded) / RATE,
                  'peak_dbfs': round(20 * np.log10(max(peak, 1e-10)), 2),
                  'rms_dbfs': round(20 * np.log10(max(float(np.sqrt(np.mean(decoded ** 2))), 1e-10)), 2),
                  'leading_seconds': round(leading, 5), 'bytes': file.stat().st_size}
        if not np.isfinite(decoded).all() or peak >= .95 or peak < .02 or abs(result['duration'] - item['duration']) > .04:
            raise ValueError(f'Audio verification failed: {result}')
        if 'cue' in item and leading >= .03:
            raise ValueError(f'Excessive leading silence: {result}')
        results.append(result)
    qa = {'method': 'MP3 decoded with local FFmpeg; numeric checks, not listening approval',
          'files': results, 'total_mp3_bytes': sum(item['bytes'] for item in results),
          'decoded_seconds': round(sum(item['duration'] for item in results), 3),
          'maximum_decoded_peak_dbfs': max(item['peak_dbfs'] for item in results)}
    (OUTPUT / 'qa.json').write_text(json.dumps(qa, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return qa


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overwrite', action='store_true', help='Regenerate only this task-owned v1 audition bank')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    if not shutil.which('ffmpeg'):
        raise SystemExit('Local ffmpeg is required; no download or install will be attempted.')
    if args.verify_only:
        qa = verify(json.loads((OUTPUT / 'manifest.json').read_text(encoding='utf-8')))
        print(json.dumps({key: value for key, value in qa.items() if key != 'files'}, ensure_ascii=False))
        return
    if (OUTPUT / 'manifest.json').exists() and not args.overwrite:
        raise SystemExit('Audition bank exists; use --overwrite only to regenerate these owned outputs.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    MASTERS.mkdir(parents=True, exist_ok=True)
    clips, auditions, audio_by_id = [], [], {}

    def create(cue, group, count, recipe, description):
        for variant in range(count):
            name = f'{cue}-{variant + 1:02d}'
            seed = zlib.crc32(name.encode('ascii')) ^ 0x517F1201
            signal = recipe(np.random.default_rng(seed), variant)
            audio_by_id[name] = signal
            write_mp3(name, signal, f'mp3/{name}.mp3', clips, cue=cue, group=group, seed=seed,
                      description_zh=description, trigger='single action')
        print(f'Created {cue}: {count} variations', flush=True)

    create('hunter-step', 'hunter', 6, lambda r, _: hunter_step(r), '重爪慢走：承重冲击、短促钢板刮擦和克制共鸣；无吼叫或呼吸。')
    create('monster-step', 'monster', 4, lambda r, _: monster_step(r), '异形多点爪触与滑动摩擦；比 Hunter 更轻、更不规则。')
    create('monster-hit', 'monster', 3, lambda r, _: monster_hit(r), '短促组织受击与硬壳碎响，不是永久死亡声。')
    create('heavy-step', 'heavy', 4, lambda r, _: heavy_step(r), '低沉装甲落脚、甲板承重及短零件震颤。')
    create('heavy-windup', 'heavy', 1, lambda r, _: heavy_windup(r), '2 秒身体下压、装甲紧绷、抓地蓄力；不包含最后撞击。')
    create('heavy-wall-impact', 'heavy', 2, lambda r, _: heavy_impact(r), '重装身体撞击钢壁，接短装甲与结构振动；不是爆炸。')
    for weapon, label in [('pistol', '手枪'), ('smg', '冲锋枪'), ('shotgun', '散弹枪'), ('revolver', '左轮')]:
        create(f'{weapon}-shot', 'weapons', 3, lambda r, _, w=weapon: gunshot(r, w), f'{label}单次开火；单声部，供之后空间音频使用。')
    for cue, count, label in [('ui-click', 3, '点击'), ('ui-confirm', 1, '确认'), ('ui-cancel', 1, '取消'), ('ui-error', 1, '错误')]:
        create(cue, 'ui', count, lambda r, i, c=cue: interface(r, c, i), f'轻量机械电子界面反馈：{label}。')
    for cue, count, label in [('terminal-key', 3, '正确输入'), ('terminal-error', 2, '错误输入'), ('terminal-success', 1, '启动成功'), ('terminal-shock', 2, '电击')]:
        create(cue, 'terminal', count, lambda r, i, c=cue: interface(r, c, i), f'终端独立反馈：{label}；可与其他状态分别触发。')

    def demo(name, group, events, description):
        events.sort(key=lambda event: event['at'])
        duration = max(event['at'] + len(audio_by_id[event['clip']]) / RATE for event in events) + .15
        signal = np.zeros(round(duration * RATE))
        for event in events:
            add(signal, audio_by_id[event['clip']], event['at'])
        write_mp3(name, finish(signal), f'auditions/{name}.mp3', auditions, group=group,
                  events=events, description_zh=description, trigger='audition only, not a game asset')

    def event(at, cue, variant=1):
        return {'at': round(at, 3), 'clip': f'{cue}-{variant:02d}'}

    at = .25
    steps = []
    for index, gap in enumerate([1.02, .97, 1.06, .94, 1.01, .98, 1.04, .96, 1.03, 1.0]):
        steps.append(event(at, 'hunter-step', index % 6 + 1))
        at += gap
    demo('01-hunter-stalking', 'hunter', steps, '连续慢走：每步间隔 0.94–1.06 秒，六种爪步变体。')
    demo('02-monster-crawl-hit', 'monster', [event(.25 + i * .70, 'monster-step', i % 4 + 1) for i in range(8)] +
         [event(6.8 + i * .85, 'monster-hit', i + 1) for i in range(3)], '先爬行，再三次独立受击。')
    demo('03-heavy-step-charge-impact', 'heavy', [event(.25 + i * .93, 'heavy-step', i % 4 + 1) for i in range(5)] +
         [event(5.6, 'heavy-windup')] + [event(7.7 + i * .30, 'heavy-step', i + 1) for i in range(4)] +
         [event(9.15, 'heavy-wall-impact')], '五步行走 → 2 秒蓄力 → 加速脚步 → 撞墙。')
    demo('04-four-weapons', 'weapons', [event(.25 + i * .7, 'pistol-shot', i + 1) for i in range(3)] +
         [event(3.0 + i * .10, 'smg-shot', i % 3 + 1) for i in range(9)] +
         [event(5.2 + i * .8, 'shotgun-shot', i + 1) for i in range(3)] +
         [event(8.4 + i * 1.2, 'revolver-shot', i + 1) for i in range(3)], '依次手枪 → 冲锋枪短连射 → 散弹枪 → 左轮。')
    demo('05-interface', 'ui', [event(.25 + i * .55, 'ui-click', i + 1) for i in range(3)] +
         [event(2.25, 'ui-confirm'), event(3.25, 'ui-cancel'), event(4.25, 'ui-error')], '三次点击 → 确认 → 取消 → 错误，音量刻意较低。')
    demo('06-terminal', 'terminal', [event(.25 + i * .40, 'terminal-key', i + 1) for i in range(3)] +
         [event(1.9, 'terminal-error'), event(2.6, 'terminal-error', 2), event(3.7, 'terminal-success'),
          event(5.2, 'terminal-shock'), event(6.4, 'terminal-shock', 2)], '三次正确输入 → 两次错误 → 启动成功 → 两种电击。')

    manifest = {'version': VERSION, 'source': 'original-local-procedural', 'stage': 'audition-awaiting-approval',
                'downloads': [], 'recording_inputs': [], 'rate': RATE, 'encoding': 'MP3 libmp3lame 192 kbps mono',
                'script': 'scripts/create-original-audio-v1.py', 'clips': clips, 'auditions': auditions}
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    qa = verify(manifest)
    print(json.dumps({'clips': len(clips), 'auditions': len(auditions),
                      'mp3_bytes': qa['total_mp3_bytes'], 'maximum_peak_dbfs': qa['maximum_decoded_peak_dbfs']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
