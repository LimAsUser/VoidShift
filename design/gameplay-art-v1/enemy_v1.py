"""Editable Hunter and Monster studies using the crew v1 render language."""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import crew_v1 as art


HIDE = art.mat("scarred oily charcoal hide", (0.025, 0.031, 0.032), rough=0.86, grain=70)
HUNTER_SHELL = art.mat("hunter worn titanium carapace", (0.14, 0.18, 0.19), metal=0.50, rough=0.67, grain=95)
HUNTER_EDGE = art.mat("hunter abraded armor edges", (0.29, 0.33, 0.33), metal=0.64, rough=0.60, grain=120)
HUNTER_GLOW = art.mat("hunter restrained cyan seam", (0.025, 0.40, 0.46), glow=1.5)
MONSTER_HIDE = art.mat("monster charred asymmetrical tissue", (0.034, 0.025, 0.023), rough=0.90, grain=63)
MONSTER_PLATE = art.mat("monster corroded black rust shell", (0.17, 0.13, 0.11), metal=0.45, rough=0.76, grain=85)
MONSTER_EDGE = art.mat("monster flaking oxidized metal", (0.30, 0.23, 0.19), metal=0.52, rough=0.81, grain=110)
EMBER = art.mat("monster deep ember fissure", (0.45, 0.045, 0.014), glow=1.3)
CLAW = art.mat("hard black keratin claws", (0.035, 0.047, 0.050), metal=0.36, rough=0.52, grain=90)


def plate(name, center, half_width, half_length, height, material, taper=0.22, asymmetry=0):
    """A thin, tapered dorsal plate whose footprint reads from directly above."""
    x, y, z = center
    front_width = half_width * (1 - taper)
    points = [(-front_width + asymmetry, -half_length),
              (front_width + asymmetry, -half_length),
              (half_width, half_length), (-half_width, half_length)]
    verts = [(x + px, y + py, z + dz) for dz in (0, height) for px, py in points]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    bevel = obj.modifiers.new("chipped shell perimeter", "BEVEL")
    bevel.width = min(0.02, height * 0.24)
    bevel.segments = 2
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def claw_chain(name, root, knuckle, tip, material=CLAW, width=0.055):
    art.tube(f"{name} proximal talon", root, knuckle, width, material, 10)
    art.tube(f"{name} curved sharp tip", knuckle, tip, width * 0.55, material, 8)


def hunter():
    root = bpy.data.objects.new("HUNTER editable body root", None)
    bpy.context.collection.objects.link(root)
    before = set(bpy.context.scene.objects)

    art.sphere("hunter low sinewy trunk", (0, 0.12, 0.62), (0.39, 0.70, 0.30), HIDE)
    art.sphere("hunter rear haunches", (0, 0.50, 0.60), (0.38, 0.35, 0.28), HIDE)
    plate("hunter forward shoulder armor", (0, -0.31, 0.85), 0.40, 0.25, 0.10, HUNTER_SHELL, 0.35)
    plate("hunter central armored spine", (0, 0.10, 0.86), 0.34, 0.40, 0.11, HUNTER_SHELL, 0.24)
    plate("hunter rear armor shell", (0, 0.56, 0.79), 0.36, 0.23, 0.09, HUNTER_EDGE, 0.40)
    for y, width in [(-0.18, 0.22), (0.08, 0.27), (0.36, 0.22), (0.60, 0.15)]:
        plate("hunter articulated spine scale", (0, y, 0.98), width, 0.075, 0.07,
              HUNTER_EDGE if y == 0.08 else HUNTER_SHELL, 0.35)
        art.box("hunter cool spine seam", (0, y, 1.054), (0.035, 0.075, 0.008), HUNTER_GLOW, 0.002)

    art.sphere("hunter lowered neck", (0, -0.50, 0.59), (0.25, 0.31, 0.19), HIDE)
    plate("hunter pointed cranial shell", (0, -0.67, 0.75), 0.27, 0.33, 0.11, HUNTER_SHELL, 0.70)
    plate("hunter narrow forward snout", (0, -0.92, 0.60), 0.14, 0.25, 0.07, HUNTER_EDGE, 0.74)
    for side in (-1, 1):
        art.box("hunter cold eye slit", (side * 0.16, -0.89, 0.69), (0.07, 0.035, 0.025), HUNTER_GLOW, 0.004)
        art.tube("hunter steel mandible", (side * 0.14, -0.92, 0.55),
                 (side * 0.07, -1.17, 0.47), 0.035, CLAW, 10)
        art.box("hunter shoulder hard cap", (side * 0.37, -0.34, 0.73),
                (0.26, 0.27, 0.15), HUNTER_SHELL, 0.025)
        art.box("hunter cyan shoulder channel", (side * 0.37, -0.36, 0.82),
                (0.035, 0.20, 0.008), HUNTER_GLOW, 0.002)

        # Front and rear legs have different bends; neither copies the crew silhouette.
        for label, hip_y, elbow_y, foot_y in (("front", -0.31, -0.57, -0.76),
                                              ("rear", 0.52, 0.82, 0.59)):
            hip = (side * 0.39, hip_y, 0.61)
            elbow = (side * (0.72 if label == "front" else 0.68), elbow_y, 0.42)
            foot = (side * (0.80 if label == "front" else 0.76), foot_y, 0.11)
            art.tube(f"hunter {label} tendon", hip, elbow, 0.12 if label == "front" else 0.13, HIDE)
            art.tube(f"hunter {label} lower limb", elbow, foot, 0.085, HIDE)
            art.box(f"hunter {label} upper shell", ((hip[0] + elbow[0]) / 2, (hip[1] + elbow[1]) / 2,
                                                    (hip[2] + elbow[2]) / 2 + 0.05),
                    (0.21, 0.28, 0.14), HUNTER_SHELL, 0.035)
            art.box(f"hunter {label} knee guard", elbow, (0.16, 0.18, 0.13), HUNTER_EDGE, 0.022)
            art.box(f"hunter {label} clawed foot", foot, (0.19, 0.16, 0.11), CLAW, 0.022)
            for finger in (-1, 0, 1):
                claw_chain(f"hunter {label} {side} {finger}",
                           (foot[0] + finger * 0.052, foot[1] - 0.07, foot[2]),
                           (foot[0] + finger * 0.067, foot[1] - 0.17, 0.065),
                           (foot[0] + finger * 0.072, foot[1] - 0.23, 0.04), width=0.022)

    tail_points = [(0, 0.75, 0.55), (0, 1.01, 0.46), (0.07, 1.25, 0.31), (0.15, 1.48, 0.19)]
    for index in range(len(tail_points) - 1):
        art.tube("hunter tapering armored tail", tail_points[index], tail_points[index + 1],
                 0.11 - index * 0.027, HUNTER_SHELL, 10)
    claw_chain("hunter tail spike", tail_points[-1], (0.20, 1.61, 0.16), (0.27, 1.71, 0.12), CLAW, 0.035)

    for obj in set(bpy.context.scene.objects) - before:
        obj.parent = root


def monster():
    root = bpy.data.objects.new("MONSTER editable body root", None)
    bpy.context.collection.objects.link(root)
    before = set(bpy.context.scene.objects)

    art.sphere("monster tall warped core", (0.03, 0.02, 1.45), (0.39, 0.29, 0.70), MONSTER_HIDE)
    art.sphere("monster narrow waist", (-0.04, 0.05, 0.98), (0.28, 0.24, 0.31), MONSTER_HIDE)
    art.sphere("monster offset shoulder mass", (-0.12, 0.06, 1.92), (0.58, 0.31, 0.28), MONSTER_HIDE)
    art.panel("monster left overgrown chest shell", (-0.23, -0.27, 1.63), 0.46, 0.65,
              0.15, MONSTER_PLATE, 0.34, -0.08)
    art.panel("monster broken right chest shell", (0.28, -0.23, 1.52), 0.31, 0.50,
              0.12, MONSTER_EDGE, 0.37, 0.06)
    plate("monster offset upper back armor", (-0.10, 0.18, 2.04), 0.48, 0.28,
          0.12, MONSTER_PLATE, 0.34, -0.12)
    for index, z in enumerate((1.18, 1.45, 1.70, 1.91)):
        art.cable(f"monster ragged ember torso fissure {index}",
                  [(-0.20 + index * 0.025, -0.35, z - 0.14),
                   (-0.15 + index * 0.020, -0.37, z),
                   (-0.06 + index * 0.018, -0.34, z + 0.08)],
                  0.010, EMBER)

    # One arm is an oversized claw; the other is thinner and visually unstable.
    for side in (-1, 1):
        heavy = side < 0
        shoulder = (side * (0.52 if heavy else 0.43), 0.01, 1.91 if heavy else 1.78)
        elbow = (side * (0.86 if heavy else 0.72), -0.11, 1.17 if heavy else 1.22)
        hand = (side * (0.96 if heavy else 0.88), -0.37, 0.62 if heavy else 0.74)
        art.sphere("monster asymmetric shoulder", shoulder,
                   (0.31, 0.29, 0.29) if heavy else (0.20, 0.23, 0.21), MONSTER_HIDE)
        art.tube("monster elongated upper limb", shoulder, elbow,
                 0.20 if heavy else 0.12, MONSTER_HIDE)
        art.tube("monster elongated forearm", elbow, hand,
                 0.17 if heavy else 0.09, MONSTER_HIDE)
        art.box("monster split shoulder plate", (shoulder[0], -0.12, shoulder[2] + 0.09),
                (0.37, 0.30, 0.16) if heavy else (0.26, 0.26, 0.12),
                MONSTER_PLATE, 0.035)
        art.box("monster corroded elbow shell", elbow,
                (0.29, 0.26, 0.22) if heavy else (0.18, 0.20, 0.15),
                MONSTER_EDGE, 0.027)
        art.box("monster claw wrist", hand,
                (0.28, 0.27, 0.20) if heavy else (0.18, 0.23, 0.16),
                MONSTER_PLATE, 0.023)
        for finger in (-1, 0, 1):
            start = (hand[0] + finger * (0.10 if heavy else 0.07), hand[1] - 0.09, hand[2] - 0.04)
            knuckle = (start[0] + side * 0.04, start[1] - 0.23, start[2] - 0.10)
            tip = (knuckle[0] + side * 0.08, knuckle[1] - 0.18, knuckle[2] - 0.11)
            claw_chain(f"monster {side} talon {finger}", start, knuckle, tip,
                       MONSTER_EDGE if heavy else CLAW, 0.055 if heavy else 0.033)
        art.cable("monster forearm ember seam", [shoulder, (side * 0.72, -0.28, 1.36), hand],
                  0.014 if heavy else 0.009, EMBER)

    art.sphere("monster offset lowered head", (0.14, -0.21, 2.16), (0.26, 0.24, 0.31), MONSTER_HIDE)
    art.panel("monster forward cranial armor", (0.14, -0.42, 2.20), 0.35, 0.45,
              0.11, MONSTER_PLATE, 0.48, 0.06)
    art.box("monster narrow dark red eye cleft", (0.14, -0.51, 2.19), (0.18, 0.02, 0.027), EMBER, 0.004)
    art.cable("monster offset crown fissure", [(0.10, -0.30, 2.43), (0.19, -0.19, 2.50),
                                                (0.25, 0.04, 2.42)], 0.012, EMBER)

    for side in (-1, 1):
        hip = (side * 0.19, 0.05, 0.93)
        knee = (side * (0.30 if side < 0 else 0.25), -0.14, 0.50)
        foot = (side * (0.35 if side < 0 else 0.29), -0.36, 0.13)
        art.tube("monster sinewy thigh", hip, knee, 0.16 if side < 0 else 0.13, MONSTER_HIDE)
        art.tube("monster narrow shin", knee, foot, 0.105, MONSTER_HIDE)
        art.box("monster jagged knee plate", knee, (0.24, 0.21, 0.16), MONSTER_PLATE, 0.025)
        art.box("monster uneven foot", foot, (0.23, 0.31, 0.15), MONSTER_EDGE, 0.024)
        for toe in (-1, 0, 1):
            art.tube("monster foot hooked talon", (foot[0] + toe * 0.07, foot[1] - 0.12, 0.12),
                     (foot[0] + toe * 0.09, foot[1] - 0.30, 0.035), 0.025, CLAW, 8)

    # A few detached flakes imply unstable edges without hiding the solid silhouette.
    for side, y, z in [(-1, 0.22, 1.47), (-1, 0.09, 1.82), (1, 0.13, 1.54)]:
        art.box("monster loose oxidized shell flake", (side * 0.56, y, z),
                (0.08, 0.07, 0.13), MONSTER_EDGE, 0.008,
                (0.18, side * 0.33, side * 0.23))

    for obj in set(bpy.context.scene.objects) - before:
        obj.parent = root


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True, choices=("hunter", "monster"))
    parser.add_argument("--output", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    os.makedirs(args.output, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    if args.kind == "hunter":
        hunter()
    else:
        monster()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.25
    art.area("large cold corridor light", (2.8, -3.5, 5.3), 480,
             (0.77, 0.86, 1.0), 3.2)
    art.area("warm maintenance rim", (-2.7, 2.4, 4.0), 220,
             (1.0, 0.67, 0.38), 2.4)
    art.area("soft front reflection", (-1.0, -3.0, 2.8), 80,
             (0.62, 0.80, 1.0), 1.5)
    top = art.camera("true vertical overhead camera", (0, 0, 8), (0, 0, 1.1), 3.05)
    quarter = art.camera("three quarter visual inspection camera", (3.1, -5.8, 3.0),
                         (0, 0, 1.1), 3.05)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.output, f"{args.kind}-v1.blend"))
    art.render(os.path.join(args.output, f"{args.kind}-v1-top.png"), top)
    art.render(os.path.join(args.output, f"{args.kind}-v1-threequarter.png"), quarter)


if __name__ == "__main__":
    main()
