"""Offline original V2 sound candidates. Never imports or modifies game state.

Only reuses the V1 mathematical sound primitives. No recording inputs, network
access, downloaded music, or external generation services. Auditions are not
the future game's playback implementation.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import wave
import zlib

import numpy as np

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'design/audio/feedback-v2'
MASTERS = ROOT / '.sites-runtime/feedback-v2/masters'
spec = importlib.util.spec_from_file_location('voidshift_audio_v1', Path(__file__).with_name('create-original-audio-v1.py'))
v1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1)
RATE = v1.RATE
clock, noise, metal, hit, scrape, add, finish = v1.clock, v1.noise, v1.metal, v1.hit, v1.scrape, v1.add, v1.finish


def pressure(rng, seconds, frequency, decay):
    t = clock(seconds)
    f = frequency * rng.uniform(.98, 1.02)
    phase = 2 * np.pi * (f * .64 * t + f * .36 * .027 * (1 - np.exp(-t / .027)))
    body = np.sin(phase) + .14 * np.sin(phase * 2.11)
    return body * (1 - np.exp(-t / .0007)) * np.exp(-t / decay)


def room_tail(signal, taps=((.014, .10), (.027, .055), (.043, .025))):
    dry = signal.copy()
    for at, gain in taps:
        add(signal, dry, at, gain)
    return signal


def weapon(rng, kind):
    # Matched peaks, intentionally different body/noise balance and decay.
    seconds, frequency, decay, body_gain, crack_gain = {
        'smg': (.145, 240, .018, .24, .80),
        'pistol': (.32, 184, .041, .70, .64),
        'revolver': (.48, 118, .082, 1.12, .54),
        'shotgun': (.56, 87, .125, 1.48, .45),
    }[kind]
    t = clock(seconds)
    attack = 1 - np.exp(-t / .00024)
    signal = body_gain * pressure(rng, seconds, frequency, decay)
    signal += crack_gain * noise(rng, seconds, 1150, 8600) * np.exp(-t / (.0045 if kind == 'smg' else .007)) * attack
    signal += .22 * noise(rng, seconds, 180, 3200) * np.exp(-t / (decay * .48)) * attack
    if kind == 'shotgun':
        # A broad pressure shoulder, not a long explosive rumble.
        signal += .24 * noise(rng, seconds, 70, 740) * np.exp(-t / .065) * attack
        add(signal, metal(rng, .13, [203, 521, 1171, 2917], .026), .055, .10)
    elif kind == 'revolver':
        add(signal, metal(rng, .15, [359, 743, 1531, 3299], .035), .028, .15)
    else:
        add(signal, metal(rng, .09, [671, 1277, 3011], .013), .018, .11)
    taps = ((.009, .07), (.018, .025)) if kind == 'smg' else ((.013, .12), (.026, .065), (.041, .025))
    return finish(room_tail(signal, taps), .56)


def movement(rng, creature, chase=False):
    seconds = {'hunter': .62, 'monster': .53, 'heavy': .84}[creature]
    if chase:
        seconds = .35 if creature == 'hunter' else .31
    signal = np.zeros(round(seconds * RATE))
    if creature == 'hunter':
        add(signal, pressure(rng, seconds, 109, .055), 0, .55)
        add(signal, hit(rng, seconds, 149, 5200, .037), 0, .38)
        add(signal, scrape(rng, .22 if not chase else .14, 580, 6400), .023, .48)
        add(signal, metal(rng, seconds, [127, 281, 613, 1187], .09), .004, .09)
        peak = .41 if not chase else .45
    elif creature == 'monster':
        for at, gain in [(0, .2), (.033, .13), (.103, .18), (.17, .10)]:
            add(signal, hit(rng, .15, 237, 6800, .017), at, gain)
        add(signal, scrape(rng, .40, 900, 6700), .009, .25)
        add(signal, noise(rng, .38, 100, 640) * np.exp(-clock(.38) / .07), 0, .14)
        peak = .29
    else:
        add(signal, pressure(rng, seconds, 63, .135 if not chase else .075), 0, .8)
        add(signal, hit(rng, seconds, 82, 3600, .065), 0, .35)
        add(signal, metal(rng, seconds, [49, 113, 197, 431], .18), .005, .18)
        for at, gain in [(.035, .12), (.095, .06), (.17, .025)]:
            add(signal, metal(rng, .16, [269, 599, 1289, 2503], .037), at, gain)
        peak = .47
    return finish(room_tail(signal, ((.025, .055),)), peak)


def attack(rng, creature):
    seconds = .36
    t = clock(seconds)
    signal = noise(rng, seconds, 180, 2800) * np.sin(np.pi * t / seconds) ** 4 * np.exp(-t / .16) * .34
    add(signal, scrape(rng, .20, 800 if creature == 'monster' else 430, 6200), .003, .36)
    add(signal, hit(rng, .18, 155, 4200, .025), 0, .20)
    return finish(signal, .37)


def wound(rng, kind):
    seconds = .36 if kind != 'heavy-armor' else .24
    signal = hit(rng, seconds, 160, 3700, .046)
    if kind == 'heavy-armor':
        signal *= .15
        add(signal, metal(rng, seconds, [389, 931, 1801, 3379], .047), 0, .6)
    else:
        t = clock(seconds)
        texture = noise(rng, seconds, 130, 1900) * np.exp(-t / .05) * (.55 + .45 * np.sin(2 * np.pi * 113 * t))
        add(signal, texture, .009, .24)
        add(signal, pressure(rng, seconds, 116 if kind == 'monster' else 145, .045), 0, .13)
    return finish(signal, .34)


def body_event(rng, cue):
    seconds = {'hunter-death': 1.08, 'hunter-revive': 1.75, 'monster-dormant': 1.06,
               'monster-wake': 1.25, 'heavy-death': 1.95, 'heavy-recover': .68}[cue]
    signal = np.zeros(round(seconds * RATE))
    if cue == 'hunter-death':
        add(signal, wound(rng, 'hunter'), 0, .40)
        add(signal, scrape(rng, .32, 440, 4500), .13, .25)
        add(signal, pressure(rng, .80, 96, .095), .26, .7)
        add(signal, metal(rng, .72, [113, 241, 419, 877], .16), .28, .15)
        add(signal, hit(rng, .20, 183, 3800, .023), .44, .13)
        peak = .48
    elif cue == 'heavy-death':
        add(signal, metal(rng, .35, [73, 199, 557], .065), 0, .18)
        add(signal, scrape(rng, .42, 220, 3200), .065, .20)
        add(signal, pressure(rng, 1.35, 53, .26), .32, 1.0)
        add(signal, hit(rng, 1.2, 81, 5900, .12), .32, .40)
        add(signal, metal(rng, 1.3, [47, 83, 173, 349, 719], .26), .34, .22)
        for at, gain in [(.50, .25), (.72, .14), (.99, .07)]:
            add(signal, metal(rng, .45, [183, 499, 1103, 2371], .065), at, gain)
        peak = .58
    elif cue == 'monster-dormant':
        add(signal, hit(rng, .28, 135, 3000, .045), 0, .3)
        add(signal, scrape(rng, .67, 330, 3900), .017, .42)
        add(signal, pressure(rng, .60, 127, .085), .12, .24)
        peak = .37
    else:
        # Movement alone conveys reanimation; no warning beep or countdown.
        add(signal, scrape(rng, .24, 530, 3700), 0, .08)
        grab = .23 if cue == 'hunter-revive' else .12
        add(signal, scrape(rng, .34, 570, 4500), grab, .35)
        add(signal, metal(rng, .40, [137, 311, 709, 1493], .08), grab, .13)
        add(signal, scrape(rng, .48, 170, 2400), min(.68, seconds - .51), .13)
        add(signal, movement(rng, 'heavy' if cue == 'heavy-recover' else 'hunter' if cue == 'hunter-revive' else 'monster'),
            seconds - .40, .46)
        peak = .39
    return finish(room_tail(signal, ((.027, .055),)), peak)


def heavy_action(rng, cue):
    if cue == 'heavy-windup':
        signal = v1.heavy_windup(rng).astype(float) * .6
        add(signal, pressure(rng, .4, 74, .09), 0, .23)
        for at in [.31, .63, 1.01, 1.37, 1.62]:
            add(signal, metal(rng, .30, [67, 153, 367], .08), at, .10)
        return finish(signal, .43)
    if cue == 'heavy-charge-start':
        signal = movement(rng, 'heavy', True).astype(float)
        add(signal, scrape(rng, .20, 430, 3900), .01, .3)
        return finish(signal, .53)
    signal = v1.heavy_impact(rng).astype(float) * .55
    add(signal, pressure(rng, 1.2, 51, .20), 0, .55)
    return finish(room_tail(signal, ((.017, .11), (.041, .065))), .57)


def mechanism(rng, cue):
    seconds = {'terminal-success': 1.22, 'terminal-all-confirm': 1.10, 'power-instability': .28,
        'power-down': .85, 'emergency-system': .58, 'extraction-ready': .55, 'airlock-seal': .72,
        'engine-start': 3.35, 'victory-impact': 1.5, 'failure-device-stop': 1.40, 'failure-impact': 1.15,
        'result-tick': .11, 'result-confirm': .35, 'ui-purchase': .34, 'ui-sell': .34, 'ui-equip': .34}[cue]
    signal = np.zeros(round(seconds * RATE))
    peak = .35
    if cue in ['engine-start', 'power-down', 'failure-device-stop']:
        t = clock(seconds)
        start = cue == 'engine-start'
        envelope = (.06 + .55 * np.minimum(1, t / 1.8)) if start else (.65 * np.exp(-t / .27))
        signal = noise(rng, seconds, 35, 360) * envelope
        phase = 2 * np.pi * (44 * t + 10 * t * t) if start else 2 * np.pi * (31 * t + 54 * .21 * (1 - np.exp(-t / .21)))
        signal += .22 * np.sin(phase) * envelope
        signal += noise(rng, seconds, 340, 1700) * envelope * .14
        add(signal, metal(rng, .18, [183, 521, 1379], .025), 0, .15)
        # A closing envelope is explicit so an interrupted mechanical loop has no hard cutoff.
        signal[-round(min(.5, seconds / 2) * RATE):] *= np.linspace(1, 0, round(min(.5, seconds / 2) * RATE))
        peak = .26 if start else .32
    elif cue in ['terminal-success', 'terminal-all-confirm', 'victory-impact', 'failure-impact']:
        if cue == 'terminal-success':
            add(signal, hit(rng, .18, 188, 3200, .025), 0, .2)
            add(signal, pressure(rng, .68, 135, .13), .06, .5)
            add(signal, metal(rng, .70, [223, 487, 997], .15), .14, .17)
            for at in [.03, .25, .40]:
                add(signal, metal(rng, .14, [553, 1297, 2801], .02), at, .15)
            peak = .47
        elif cue == 'terminal-all-confirm':
            add(signal, pressure(rng, 1.0, 81, .18), 0, .7)
            add(signal, metal(rng, .85, [97, 223, 503, 1069], .17), .02, .25)
            add(signal, hit(rng, .25, 179, 4300, .035), 0, .30)
            peak = .53
        elif cue == 'victory-impact':
            add(signal, pressure(rng, 1.4, 71, .27), 0, .78)
            add(signal, hit(rng, .5, 120, 4200, .05), 0, .23)
            add(signal, metal(rng, 1.30, [101, 239, 557, 1181], .25), .013, .21)
            add(signal, scrape(rng, .26, 430, 3000), .09, .06)
            peak = .59
        else:
            add(signal, pressure(rng, 1.0, 57, .20), 0, .55)
            add(signal, metal(rng, .65, [83, 173, 397], .16), .016, .10)
            peak = .32
    elif cue == 'airlock-seal':
        add(signal, scrape(rng, .48, 130, 2500), 0, .24)
        add(signal, hit(rng, .42, 94, 4300, .07), .18, .5)
        add(signal, pressure(rng, .45, 84, .09), .18, .45)
        add(signal, metal(rng, .17, [331, 733, 1667], .027), .42, .18)
        peak = .45
    elif cue == 'power-instability':
        add(signal, v1.interface(rng, 'terminal-shock'), 0, .5)
        peak = .15
    elif cue in ['emergency-system', 'extraction-ready']:
        t = clock(seconds)
        center = 181 if cue == 'emergency-system' else 397
        gates = (np.sin(2 * np.pi * 4.7 * t) > 0).astype(float)
        signal += np.sin(2 * np.pi * center * t) * gates * np.exp(-t / .14) * .07
        add(signal, metal(rng, .25, [211, 461, 1013], .045), 0, .16)
        peak = .24
    else:
        add(signal, hit(rng, min(seconds, .15), 450, 4300, .006), 0, .16)
        frequencies = {'ui-equip': [271, 673, 1723], 'ui-purchase': [487, 1193],
            'ui-sell': [383, 907], 'result-confirm': [431, 1019]}.get(cue, [709, 1721])
        add(signal, metal(rng, seconds, frequencies, .026), .008, .18)
        if cue != 'result-tick':
            add(signal, metal(rng, .10, frequencies, .018), .10, .095)
        peak = .14 if cue == 'result-tick' else .23
    return finish(room_tail(signal, ((.021, .04),)), peak)


def duck_curve(seconds, pulses):
    t = clock(seconds)
    gain = np.ones(len(t))
    for at, depth, hold in pulses:
        phase = t - at
        target = 10 ** (-depth / 20)
        amount = np.where(phase < 0, 0, np.where(phase < .008, phase / .008,
            np.where(phase < hold, 1, np.maximum(0, 1 - (phase - hold) / .09))))
        gain = np.minimum(gain, 1 - amount * (1 - target))
    return gain


def retained_interface(rng, cue, index):
    base = v1.interface(rng, cue, index)
    latch = metal(rng, len(base) / RATE, [343, 937, 2281], .018) * .045
    return finish(base + latch, .16 if cue.startswith('ui') else .22)


def decode(file):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-f', 'f32le', '-ac', '1',
                          '-ar', str(RATE), 'pipe:1'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<f4')


def save(name, signal, folder, items, **metadata):
    file = BANK / folder / (name + '.mp3')
    file.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.round(signal * 32767).astype('<i2').tobytes()
    master = MASTERS / (name + '.wav')
    with wave.open(str(master), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE); out.writeframes(pcm)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(master), '-map_metadata', '-1',
        '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '1', '-ar', str(RATE),
        '-metadata', f'title=VOID SHIFT {name} V2 candidate', str(file)], check=True)
    items.append({'id': name, 'file': file.relative_to(BANK).as_posix(), 'duration': round(len(signal) / RATE, 6),
                  'pcm_sha256': hashlib.sha256(pcm).hexdigest(), 'loop': False, **metadata})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    if not shutil.which('ffmpeg'):
        raise SystemExit('Local FFmpeg required; no download/install will be attempted.')
    if (BANK / 'manifest.json').exists() and not args.overwrite:
        raise SystemExit('V2 bank exists. Explicit --overwrite is required to regenerate owned candidates.')
    BANK.mkdir(parents=True, exist_ok=True); MASTERS.mkdir(parents=True, exist_ok=True)
    clips, auditions, signals = [], [], {}

    def create(cue, count, recipe, group, description, decision='new-v2'):
        for index in range(count):
            name = f'{cue}-{index + 1:02d}'
            seed = zlib.crc32(name.encode()) ^ 0x20260929
            signal = recipe(np.random.default_rng(seed), index)
            signals[name] = signal
            save(name, signal, 'mp3', clips, cue=cue, group=group, seed=seed, one_shot=True,
                 decision=decision, description_zh=description)
        print(f'{cue}: {count}', flush=True)

    for kind in ['smg', 'pistol', 'revolver', 'shotgun']:
        create(kind + '-shot', 3, lambda r, _, k=kind: weapon(r, k), 'weapons', '匹配峰值的独立枪声结构：瞬态、压力体、枪机、短舱室反射。', 'remake-v2')
    for creature in ['hunter', 'monster', 'heavy']:
        create(creature + '-step', 4, lambda r, _, c=creature: movement(r, c), creature, '独立实际落脚，材质与承重按怪物区分。', 'remix-v1-primitives')
    create('hunter-chase', 3, lambda r, _: movement(r, 'hunter', True), 'hunter', '更短、更急促的追击爪步。')
    for creature in ['hunter', 'monster']:
        create(creature + '-attack', 2, lambda r, _, c=creature: attack(r, c), creature, '扑击／前窜动作；不混入命中确认。')
        create(creature + '-hit', 2, lambda r, _, c=creature: wound(r, c), creature, '短受击与组织、硬壳反馈。')
    for cue in ['hunter-death', 'hunter-revive', 'monster-dormant', 'monster-wake', 'heavy-death', 'heavy-recover']:
        create(cue, 2 if cue.endswith('death') else 1, lambda r, _, c=cue: body_event(r, c), cue.split('-')[0],
               '生命期动作；Monster 是休眠不是击杀，复生不含倒计时／警告音。')
    for cue in ['heavy-windup', 'heavy-charge-start', 'heavy-wall-impact']:
        create(cue, 2 if cue.endswith('impact') else 1, lambda r, _, c=cue: heavy_action(r, c), 'heavy',
               '重型装甲机械动作，蓄力2秒，撞墙是钝撞不是爆炸。', 'remix-v1-primitives')
    create('heavy-charge-step', 3, lambda r, _: movement(r, 'heavy', True), 'heavy', '短重步，便于0.3秒冲撞节奏。')
    create('heavy-armor-hit', 2, lambda r, _: wound(r, 'heavy-armor'), 'heavy', '厚甲挡击，不代表造成有效伤害。')
    create('heavy-weak-hit', 2, lambda r, _: wound(r, 'heavy'), 'heavy', '装甲失效时的有效受击。')
    for cue, count in [('ui-click', 3), ('ui-confirm', 1), ('ui-cancel', 1), ('ui-error', 1), ('terminal-key', 3), ('terminal-error', 2)]:
        create(cue, count, lambda r, i, c=cue: retained_interface(r, c, i),
            'ui' if cue.startswith('ui') else 'terminal', '保留V1短反馈结构，降低纯音主导程度并加入短机械接触。', 'retain-remix-candidate')
    for cue in ['terminal-success', 'terminal-all-confirm', 'power-instability', 'power-down', 'emergency-system',
                'extraction-ready', 'airlock-seal', 'engine-start', 'victory-impact', 'failure-device-stop',
                'failure-impact', 'result-tick', 'result-confirm', 'ui-purchase', 'ui-sell', 'ui-equip']:
        create(cue, 1, lambda r, _, c=cue: mechanism(r, c),
               'terminal' if cue.startswith(('terminal', 'power', 'emergency', 'extraction')) else 'outcome' if not cue.startswith('ui') else 'ui',
               '独立工业机械／系统状态声；组合演示不改变游戏状态。', 'remake-v2' if cue == 'terminal-success' else 'new-v2')

    def e(at, cue, variant=1, gain=1):
        return {'at': round(at, 3), 'clip': f'{cue}-{variant:02d}', 'gain': gain}

    def demo(name, events, seconds, description, ducks=(), isolate_at=None, bed=.008):
        events.sort(key=lambda event: event['at'])
        rng = np.random.default_rng(zlib.crc32(name.encode()))
        ambient = noise(rng, seconds, 35, 430) * bed
        ambient *= duck_curve(seconds, ducks)
        if isolate_at is not None:
            ambient *= np.clip((isolate_at + .1 - clock(seconds)) / .1, 0, 1)
        signal = ambient
        for event in events:
            add(signal, signals[event['clip']], event['at'], event['gain'])
        save(name, finish(signal), 'auditions', auditions, events=events, description_zh=description,
             ducks=[{'at': a, 'depth_db': d, 'hold': h} for a, d, h in ducks], world_isolated_at=isolate_at,
             offline_presentation_only=True)

    demo('01-four-weapons', [e(.2+i*.6,'pistol-shot',i+1) for i in range(3)] +
         [e(2.6+i*.1,'smg-shot',i%3+1) for i in range(15)] +
         [e(5.2+i*1.2,'revolver-shot',i+1) for i in range(3)] +
         [e(9.0+i*.8,'shotgun-shot',i+1) for i in range(3)], 11.6,
         '手枪 → SMG 15发短连射 → 左轮 → 散弹枪；单发峰值接近，比较结构而非音量。', [(9,4,.12),(9.8,4,.12),(10.6,4,.12)])
    demo('02-hunter-lifecycle', [e(.2+i*1.0,'hunter-step',i+1) for i in range(4)] +
         [e(4.3+i*.34,'hunter-chase',i%3+1) for i in range(5)] +
         [e(6.3,'hunter-attack'),e(6.8,'hunter-hit'),e(7.2,'hunter-death'),e(12.45,'hunter-revive')],
         14.5, '慢走 → 追击 → 攻击 → 受击 → 倒地 → 安静 → 起身。倒下到站稳相隔7秒。', [(7.2,3,.08)])
    demo('03-monster-dormancy', [e(.2+i*.63,'monster-step',i%4+1) for i in range(5)] +
         [e(3.6,'monster-attack'),e(4.1,'monster-hit'),e(4.7,'monster-dormant'),e(6.8,'monster-wake')], 8.35,
         '多爪移动 → 攻击 → 受击 → 休眠倒下 → 苏醒；为试听压缩了等待，游戏20秒休眠不变。')
    demo('04-heavy-weight', [e(.2+i*.93,'heavy-step',i+1) for i in range(4)] +
         [e(4.2,'heavy-windup'),e(6.2,'heavy-charge-start')] +
         [e(6.55+i*.3,'heavy-charge-step',i%3+1) for i in range(5)] +
         [e(8.2,'heavy-wall-impact'),e(10.1,'heavy-armor-hit'),e(10.7,'heavy-weak-hit'),e(11.5,'heavy-death')], 13.7,
         '行走 → 蓄力 → 蹬地冲撞 → 撞墙 → 护甲挡击／弱点受击对比 → 死亡；后半为分段展示。', [(8.2,5,.14),(11.5,5,.14)])
    demo('05-terminal-single', [e(0,'terminal-key',3),e(.15,'terminal-success')], 1.7,
         '最后输入 → 150ms停顿 → 系统确认、继电器与设备启动。', [(0,3,.12)])
    demo('06-terminal-all', [e(0,'terminal-key',3),e(.15,'terminal-all-confirm'),e(.5,'power-instability'),
         e(1,'power-instability'),e(1.5,'power-instability'),e(2,'power-down'),e(2.2,'emergency-system'),e(2.8,'extraction-ready')], 3.6,
         '最终输入 → 深沉确认 → 电力不稳 → 停电 → 应急系统 → 撤离可用。', [(0,6,.16),(2,4,.13)])
    victory_events = [e(.3,'airlock-seal'),e(1.2,'engine-start'),e(1.8,'victory-impact')]
    victory_events += [e(at,'result-tick') for at in [2.6,3.2,3.8,4.4,5.0,5.5]] + [e(5.6,'result-confirm')]
    demo('07-victory', victory_events, 6.5,
         '0.3s封舱、0.8s隔绝危险、1.2s引擎、1.8s任务完成、2.5s后统计、6.5s结果；没有音乐或配音。', [(1.8,6,.18)], .8, .019)
    demo('08-failure', [e(0,'failure-device-stop'),e(.65,'failure-impact')], 2.5,
         '危险环境压低、设备失去动力、冷峻失败确认；无Jumpscare。', [(0,4,.18)], .25, .012)
    demo('09-ui-mechanical', [e(.15,'ui-click'),e(.7,'ui-confirm'),e(1.3,'ui-cancel'),e(1.9,'ui-error'),
         e(2.6,'ui-purchase'),e(3.3,'ui-sell'),e(4,'ui-equip')], 4.6,
         '点击 → 确认 → 取消 → 错误 → 购买 → 出售 → 装备；不使用金币或闪耀音。', bed=0)
    demo('00-feedback-ladder', [e(.2,'ui-click'),e(1.2,'hunter-hit'),e(2.5,'hunter-death'),e(5,'heavy-death'),
         e(8.0,'terminal-success'),e(10.2,'terminal-all-confirm'),e(11.3,'power-down'),e(12.3,'extraction-ready'),
         e(14.1,'airlock-seal'),e(15.0,'engine-start'),e(15.6,'victory-impact'),e(18.2,'result-confirm')], 19.5,
         '层级方向试听：操作 → 命中 → Hunter倒地 → Heavy死亡 → 单终端 → 全终端 → 安全撤离。不是游戏流程时间轴。',
         [(2.5,3,.08),(5,5,.14),(8,4,.12),(10.2,6,.16),(15.6,6,.18)], 14.6, .010)

    manifest = {'version':'feedback-v2', 'status':'candidate-awaiting-listening-approval', 'downloads':[],
        'source':'local original procedural design; V1 math primitives reused, V1 files unchanged',
        'rate':RATE, 'channels':1, 'encoding':'MP3 libmp3lame 192 kbps',
        'script':'scripts/create-feedback-audio-v2.py', 'clips':clips, 'auditions':auditions,
        'not_implemented':['runtime audio routing','gameplay visuals','voice manager','network V16','outcome state machine']}
    (BANK / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    rows=[]
    for item in clips+auditions:
        audio=decode(BANK/item['file']); peak=float(np.max(np.abs(audio)))
        rows.append({'file':item['file'],'duration':len(audio)/RATE,'peak_dbfs':round(20*np.log10(peak),2),
                     'rms_dbfs':round(20*np.log10(float(np.sqrt(np.mean(audio*audio)))),2),'bytes':(BANK/item['file']).stat().st_size})
    # Offline asset overlap check, not a claim that the game's voice manager is implemented.
    stress=np.zeros(round(2.3*RATE)); spans=[]
    for source in range(4):
        for index in range(20):
            at=.1*index+.007*source; clip=signals[f'smg-shot-{(index+source)%3+1:02d}']
            add(stress,clip,at,.72 if source==0 else .22);spans.append((at,at+len(clip)/RATE))
    maximum=max(sum(start<=at<end for start,end in spans) for at in [start for start,_ in spans])
    save('qa-smg-four-shooters',finish(stress),'checks',[],one_shot=False)
    stress_peak=float(np.max(np.abs(decode(BANK/'checks/qa-smg-four-shooters.mp3'))))
    qa={'files':rows,'total_mp3_bytes':sum(item['bytes'] for item in rows),'maximum_peak_dbfs':max(item['peak_dbfs'] for item in rows),
        'offline_smg_stress':{'shooters':4,'shots':80,'maximum_concurrent_shots':maximum,'decoded_peak':stress_peak,
                              'note':'Offline authored mix only; not runtime or WebRTC performance validation'}}
    (BANK/'qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'clips':len(clips),'auditions':len(auditions),'bytes':qa['total_mp3_bytes'],'maximum_peak_dbfs':qa['maximum_peak_dbfs'],'smg_max_overlap':maximum}))


if __name__ == '__main__':
    main()
