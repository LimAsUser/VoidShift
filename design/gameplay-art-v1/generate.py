"""Editable VOID SHIFT art study. Run with Blender --background --python generate.py -- --output DIR."""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def material(name, color, metallic=0.0, roughness=0.55, glow=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if glow:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = glow
    if metallic:
        noise = mat.node_tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 125
        noise.inputs["Roughness"].default_value = 0.82
        bump = mat.node_tree.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.12
        bump.inputs["Distance"].default_value = 0.018
        mat.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        mat.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


DARK = material("black rubber and charcoal fabric", (0.025, 0.034, 0.047), roughness=0.86)
ARMOR = material("worn brushed titanium armor", (0.34, 0.39, 0.42), metallic=0.83, roughness=0.37)
EDGE = material("dark gunmetal trim", (0.075, 0.10, 0.13), metallic=0.9, roughness=0.33)
GLASS = material("smoked blue visor", (0.008, 0.036, 0.058), metallic=0.56, roughness=0.12)
AMBER = material("safety amber", (0.86, 0.38, 0.055), metallic=0.48, roughness=0.4)
AMBER_LIGHT = material("amber status emitter", (1.0, 0.50, 0.10), glow=4.0)
CYAN_LIGHT = material("cold cyan emitter", (0.06, 0.60, 0.88), glow=4.0)


def box(name, at, size, mat, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("machined rounded edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        obj.modifiers.new("weighted face normals", "WEIGHTED_NORMAL")
    return obj


def ellipsoid(name, at, radius, mat, segments=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=16, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = radius
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def rod(name, start, end, radius, mat, vertices=16):
    start, end = Vector(start), Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    bevel = obj.modifiers.new("softened rim", "BEVEL")
    bevel.width = radius * 0.15
    bevel.segments = 2
    obj.modifiers.new("weighted face normals", "WEIGHTED_NORMAL")
    return obj


def hose(name, points, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coords in zip(spline.bezier_points, points):
        point.co = coords
        point.handle_left_type = point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def crew():
    # A single editable mesh assembly is the source of every camera direction.
    ellipsoid("crew pressure suit torso", (0, 0.02, 1.24), (0.38, 0.25, 0.46), DARK)
    box("crew upper chest armor", (0, -0.22, 1.37), (0.62, 0.13, 0.42), ARMOR, 0.07)
    box("crew lower abdomen armor", (0, -0.22, 1.04), (0.50, 0.13, 0.19), ARMOR, 0.035)
    box("crew chest computer", (0, -0.31, 1.40), (0.27, 0.055, 0.17), EDGE, 0.012)
    box("crew chest computer glass", (0, -0.344, 1.42), (0.13, 0.012, 0.075), GLASS, 0.004)
    for side in (-1, 1):
        x = side * 0.28
        box("crew torso safety stripe", (x, -0.296, 1.48), (0.055, 0.018, 0.28), AMBER, 0.008)
        ellipsoid("crew shoulder joint", (side * 0.43, -0.005, 1.49), (0.18, 0.23, 0.19), DARK)
        ellipsoid("crew shoulder shell", (side * 0.50, -0.07, 1.53), (0.18, 0.20, 0.14), ARMOR)
        box("crew shoulder safety stripe", (side * 0.51, -0.185, 1.59), (0.17, 0.016, 0.035), AMBER, 0.005)
        rod("crew upper arm", (side * 0.51, -0.02, 1.45), (side * 0.54, -0.25, 1.10), 0.14, DARK)
        box("crew upper arm armor", (side * 0.54, -0.13, 1.34), (0.24, 0.22, 0.25), ARMOR, 0.04)
        ellipsoid("crew elbow joint", (side * 0.55, -0.25, 1.09), (0.14, 0.14, 0.14), EDGE)
        rod("crew forearm", (side * 0.55, -0.25, 1.09), (side * 0.28, -0.54, 0.99), 0.13, DARK)
        box("crew plated gauntlet", (side * 0.42, -0.38, 1.04), (0.23, 0.29, 0.20), ARMOR, 0.04)
        box("crew gauntlet light", (side * 0.42, -0.405, 1.155), (0.025, 0.13, 0.012), AMBER_LIGHT, 0)
        ellipsoid("crew glove", (side * 0.25, -0.55, 0.95), (0.11, 0.13, 0.10), EDGE)
        ellipsoid("crew hip joint", (side * 0.19, 0.015, 0.89), (0.22, 0.21, 0.20), DARK)
        rod("crew armored thigh", (side * 0.21, -0.01, 0.90), (side * 0.23, -0.055, 0.54), 0.17, DARK)
        box("crew thigh plate", (side * 0.23, -0.17, 0.71), (0.30, 0.12, 0.30), ARMOR, 0.045)
        ellipsoid("crew knee cap", (side * 0.23, -0.10, 0.50), (0.17, 0.16, 0.14), ARMOR)
        rod("crew shin", (side * 0.23, -0.06, 0.48), (side * 0.23, -0.10, 0.19), 0.15, DARK)
        box("crew shin plate", (side * 0.23, -0.205, 0.33), (0.28, 0.13, 0.25), ARMOR, 0.03)
        box("crew heavy boot", (side * 0.23, -0.20, 0.12), (0.31, 0.43, 0.21), EDGE, 0.04)
        box("crew boot toe guard", (side * 0.23, -0.38, 0.16), (0.30, 0.10, 0.11), ARMOR, 0.02)

    box("crew oxygen backpack main", (0, 0.31, 1.30), (0.57, 0.27, 0.73), EDGE, 0.06)
    box("crew oxygen backpack shell", (0, 0.47, 1.30), (0.50, 0.09, 0.62), ARMOR, 0.025)
    for side in (-1, 1):
        rod("crew backpack pressure tank", (side * 0.27, 0.38, 1.04), (side * 0.27, 0.38, 1.63), 0.085, ARMOR)
        hose("crew breather hose", [(side * 0.27, 0.47, 1.59), (side * 0.39, 0.21, 1.75), (side * 0.23, -0.12, 1.86)], 0.025, EDGE)
        box("crew pack warning light", (side * 0.18, 0.524, 1.40), (0.045, 0.014, 0.25), AMBER_LIGHT, 0.005)
    for z in (1.10, 1.28, 1.47):
        box("crew backpack vent", (0, 0.523, z), (0.16, 0.015, 0.025), DARK, 0.004)

    ellipsoid("crew helmet collar", (0, -0.02, 1.71), (0.34, 0.31, 0.13), EDGE)
    ellipsoid("crew sealed helmet", (0, -0.04, 1.93), (0.315, 0.30, 0.31), ARMOR)
    ellipsoid("crew smoked face shield", (0, -0.245, 1.94), (0.255, 0.115, 0.23), GLASS)
    box("crew visor brow", (0, -0.30, 2.12), (0.48, 0.09, 0.055), EDGE, 0.025)
    for side in (-1, 1):
        ellipsoid("crew helmet hearing module", (side * 0.306, -0.02, 1.95), (0.075, 0.12, 0.13), EDGE)
        ellipsoid("crew cyan visor reflection", (side * 0.13, -0.342, 1.96), (0.014, 0.006, 0.09), CYAN_LIGHT)
    box("crew helmet top ridge", (0, -0.03, 2.225), (0.11, 0.39, 0.035), EDGE, 0.012)

    # Separate weapon assembly keeps the body source reusable for other loadouts.
    box("crew rifle receiver", (0.07, -0.56, 1.10), (0.18, 0.43, 0.14), EDGE, 0.025)
    rod("crew rifle barrel", (0.07, -0.75, 1.11), (0.07, -1.02, 1.11), 0.045, ARMOR)
    box("crew rifle stock", (0.07, -0.26, 1.08), (0.17, 0.19, 0.12), EDGE, 0.018)
    box("crew rifle magazine", (0.08, -0.51, 0.98), (0.12, 0.16, 0.16), ARMOR, 0.012)
    box("crew rifle sight", (0.07, -0.64, 1.195), (0.06, 0.11, 0.05), AMBER, 0.012)


def camera(name, location, target, ortho_scale):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    data.type = "ORTHO"
    data.ortho_scale = ortho_scale
    return obj


def light(name, location, power, color, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, 1.2)) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render(path, cam):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", default="crew", choices=("crew",))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    os.makedirs(args.output, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    crew()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.world.color = (0.015, 0.025, 0.04)
    scene.view_settings.view_transform = "AgX"
    light("cold main softbox", (2.4, -3.0, 5.0), 650, (0.60, 0.79, 1.0), 3.0)
    light("amber edge light", (-2.2, 2.0, 3.5), 420, (1.0, 0.55, 0.25), 2.2)
    light("cyan visor edge light", (0.3, -2.0, 3.0), 110, (0.15, 0.67, 1.0), 1.0)
    overhead = camera("true overhead game camera", (0, 0, 8), (0, 0, 1.1), 3.3)
    oblique = camera("three quarter inspection camera", (3.7, -5.0, 3.5), (0, 0, 1.1), 3.4)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.output, "crew.blend"))
    render(os.path.join(args.output, "crew-overhead.png"), overhead)
    render(os.path.join(args.output, "crew-inspection.png"), oblique)


if __name__ == "__main__":
    main()
