"""Rebuild the crew as editable hard-surface geometry; v0 stays untouched."""

import argparse
import math
import os
import random
import sys

import bpy
from mathutils import Vector


RNG = random.Random(19)


def mat(name, rgb, metal=0, rough=0.6, grain=0, glow=0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*rgb, 1)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if grain:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = grain
        noise.inputs["Detail"].default_value = 4
        noise.inputs["Roughness"].default_value = 0.76
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.18
        bump.inputs["Distance"].default_value = 0.012 if metal else 0.018
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        dirt = nodes.new("ShaderNodeTexNoise")
        dirt.inputs["Scale"].default_value = 5.5
        dirt.inputs["Detail"].default_value = 5
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.24
        ramp.color_ramp.elements[0].color = (*(component * 0.44 for component in rgb), 1)
        ramp.color_ramp.elements[1].position = 0.78
        ramp.color_ramp.elements[1].color = (*(min(1, component * 1.25) for component in rgb), 1)
        links.new(dirt.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    if glow:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Strength"].default_value = glow
    return material


FABRIC = mat("creased black pressure fabric", (0.022, 0.027, 0.033), rough=0.91, grain=48)
RUBBER = mat("matte flexible black rubber", (0.031, 0.036, 0.04), rough=0.80, grain=82)
ARMOR = mat("scarred dark titanium plate", (0.125, 0.14, 0.15), metal=0.58, rough=0.66, grain=105)
ARMOR_LIGHT = mat("abraded titanium panel edges", (0.23, 0.25, 0.26), metal=0.66, rough=0.58, grain=135)
GUNMETAL = mat("machined charcoal metal", (0.050, 0.062, 0.07), metal=0.73, rough=0.58, grain=100)
VISOR = mat("smoked dark blue reflective glass", (0.003, 0.014, 0.022), metal=0.28, rough=0.34)
HAZARD = mat("worn amber paint", (0.42, 0.25, 0.045), metal=0.20, rough=0.78, grain=72)
CYAN = mat("sealed cyan service emitter", (0.035, 0.37, 0.49), glow=1.2)
AMBER = mat("amber equipment emitter", (0.90, 0.39, 0.08), glow=1.7)
SCUFF = mat("dark exposed metal scuff", (0.065, 0.071, 0.074), metal=0.67, rough=0.82)


def box(name, pos, dims, material, bevel=0.012, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rotation:
        obj.rotation_euler = rotation
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("small machined bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def panel(name, pos, width, height, depth, material, taper=0.12, tilt=0):
    """A fitted armor shell, not a rectangular block, with irregular edges."""
    x, y, z = pos
    top = width / 2
    bottom = width * (1 - taper) / 2
    outline = [(-bottom, -height / 2), (bottom, -height / 2),
               (top + tilt, height / 2), (-top + tilt, height / 2)]
    verts = [(x + vx, y + dy, z + vz) for dy in (-depth / 2, depth / 2) for vx, vz in outline]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2),
             (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    bevel = obj.modifiers.new("subtle damaged armor edge", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def sphere(name, pos, scale, material, segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=12, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def tube(name, start, end, radius, material, vertices=14):
    start = Vector(start)
    end = Vector(end)
    axis = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=axis.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = axis.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("rounded tube lip", "BEVEL")
    bevel.width = radius * 0.12
    bevel.segments = 2
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def cable(name, points, radius, material):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.resolution_u = 16
    path = curve.splines.new("BEZIER")
    path.bezier_points.add(len(points) - 1)
    for point, xyz in zip(path.bezier_points, points):
        point.co = xyz
        point.handle_left_type = point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    curve.materials.append(material)
    return obj


def rivet(name, pos, material=GUNMETAL):
    sphere(name, pos, (0.016, 0.012, 0.016), material, 12)


def scuffs(prefix, y, x_min, x_max, z_min, z_max, count):
    for index in range(count):
        x = RNG.uniform(x_min, x_max)
        z = RNG.uniform(z_min, z_max)
        length = RNG.uniform(0.012, 0.055)
        box(f"{prefix} chipped paint {index}", (x, y, z), (length, 0.0015, 0.004), SCUFF, 0,
            (0, RNG.uniform(-0.2, 0.2), RNG.uniform(-0.7, 0.7)))


def helmet():
    # Compact helmet with a broad face shield, neck seal, brow, and segmented crown.
    tube("ribbed neck pressure collar", (0, -0.01, 1.70), (0, -0.01, 1.80), 0.31, RUBBER, 20)
    sphere("matte helmet under-shell", (0, -0.02, 1.92), (0.27, 0.285, 0.285), GUNMETAL, 32)
    sphere("dark continuous face visor", (0, -0.215, 1.91), (0.265, 0.120, 0.215), VISOR, 32)
    panel("angled visor upper brow", (0, -0.27, 2.118), 0.53, 0.074, 0.10, ARMOR_LIGHT, 0.16)
    panel("angled helmet chin guard", (0, -0.28, 1.735), 0.44, 0.070, 0.12, ARMOR, 0.23)
    for side in (-1, 1):
        x = side * 0.275
        panel("helmet slanted edge rail", (x, -0.16, 1.93), 0.065, 0.36, 0.22, ARMOR, 0.35, side * 0.024)
        box("helmet audio module", (side * 0.31, 0.02, 1.91), (0.09, 0.18, 0.18), GUNMETAL, 0.018)
        box("audio grille", (side * 0.362, -0.01, 1.91), (0.006, 0.11, 0.09), ARMOR_LIGHT, 0)
        for z in (1.875, 1.91, 1.945):
            box("audio vent slit", (side * 0.368, -0.01, z), (0.008, 0.08, 0.007), SCUFF, 0)
        panel("helmet upper segmented plate", (side * 0.15, 0.01, 2.155), 0.16, 0.39, 0.055,
              ARMOR, 0.22, side * 0.025)
        box("helmet crown hazard slash", (side * 0.15, -0.10, 2.186), (0.055, 0.16, 0.008), HAZARD, 0)
    box("helmet center crown guard", (0, 0.01, 2.20), (0.09, 0.40, 0.045), GUNMETAL, 0.015)
    box("visor cool reflection", (-0.08, -0.332, 1.99), (0.010, 0.006, 0.050), CYAN, 0.004)


def torso():
    sphere("pressure undersuit chest", (0, 0.02, 1.35), (0.33, 0.23, 0.41), FABRIC)
    box("waist fabric seal", (0, 0.02, 1.05), (0.54, 0.38, 0.19), FABRIC, 0.07)
    box("upper chest yoke", (0, -0.18, 1.54), (0.67, 0.16, 0.19), GUNMETAL, 0.026)
    for side in (-1, 1):
        x = side * 0.17
        panel("split angular chest armor", (x, -0.27, 1.38), 0.30, 0.31, 0.13, ARMOR, 0.22,
              side * 0.028)
        box("chest armor recessed seam", (x, -0.344, 1.37), (0.21, 0.012, 0.018), GUNMETAL, 0)
        box("chest shoulder harness webbing", (side * 0.295, -0.29, 1.44), (0.055, 0.022, 0.36), RUBBER, 0.009,
            (0, side * -0.12, 0))
        for z in (1.31, 1.49):
            rivet("chest plate fastener", (side * 0.28, -0.35, z))
    box("central life support bus", (0, -0.355, 1.43), (0.23, 0.065, 0.26), GUNMETAL, 0.018)
    box("life support smoked status screen", (0, -0.392, 1.48), (0.15, 0.008, 0.075), VISOR, 0.006)
    box("subtle life support indicator", (0.07, -0.399, 1.40), (0.025, 0.006, 0.018), AMBER, 0)
    box("lower armored abdomen", (0, -0.24, 1.11), (0.48, 0.12, 0.17), ARMOR, 0.025)
    box("waist utility belt", (0, -0.03, 0.985), (0.59, 0.38, 0.10), GUNMETAL, 0.014)
    for side in (-1, 1):
        box("belt equipment pouch", (side * 0.29, -0.22, 0.98), (0.16, 0.10, 0.14), ARMOR, 0.02)
    scuffs("chest", -0.345, -0.29, 0.29, 1.28, 1.55, 32)


def backpack():
    box("backpack structural frame", (0, 0.28, 1.30), (0.59, 0.20, 0.74), GUNMETAL, 0.028)
    box("backpack weathered rear armor", (0, 0.405, 1.31), (0.53, 0.10, 0.66), ARMOR, 0.035)
    box("backpack recessed central service panel", (0, 0.465, 1.33), (0.28, 0.02, 0.36), GUNMETAL, 0.008)
    for side in (-1, 1):
        x = side * 0.32
        tube("backpack oxygen cylinder", (x, 0.34, 1.00), (x, 0.34, 1.67), 0.085, ARMOR_LIGHT)
        for z in (1.06, 1.58):
            tube("tank end cap", (x, 0.34, z - 0.025), (x, 0.34, z + 0.025), 0.093, GUNMETAL)
        box("backpack side rail", (side * 0.27, 0.46, 1.31), (0.07, 0.055, 0.61), GUNMETAL, 0.01)
        box("backpack amber light", (side * 0.19, 0.475, 1.42), (0.035, 0.012, 0.20), AMBER, 0.003)
        cable("breather umbilical hose", [(x, 0.46, 1.60), (side * 0.45, 0.28, 1.76),
                                          (side * 0.34, -0.02, 1.90)], 0.021, RUBBER)
    for z in (1.18, 1.26, 1.34):
        box("backpack heatsink slit", (0, 0.479, z), (0.19, 0.008, 0.024), SCUFF, 0)
    scuffs("backpack", 0.46, -0.22, 0.22, 1.06, 1.58, 22)


def limbs():
    for side in (-1, 1):
        x = side * 0.43
        panel("layered angular shoulder cap", (side * 0.49, -0.02, 1.55), 0.31, 0.23, 0.34,
              ARMOR, 0.28, side * 0.024)
        panel("shoulder upper reinforcement", (side * 0.52, -0.05, 1.66), 0.25, 0.075, 0.28,
              ARMOR_LIGHT, 0.20)
        box("worn shoulder hazard band", (side * 0.52, -0.16, 1.697), (0.16, 0.044, 0.009), HAZARD, 0.002)
        tube("fabric upper arm", (x + side * 0.03, 0.015, 1.45), (x + side * 0.08, -0.18, 1.13), 0.115, FABRIC)
        panel("upper arm overlapping plate", (side * 0.53, -0.14, 1.32), 0.20, 0.29, 0.22,
              ARMOR, 0.22, side * 0.012)
        for z in (1.20, 1.24, 1.28):
            box("elbow fabric compression seam", (side * 0.53, -0.22, z), (0.18, 0.16, 0.012), RUBBER, 0)
        tube("fabric lower arm", (side * 0.53, -0.20, 1.16), (side * 0.36, -0.48, 1.03), 0.105, FABRIC)
        box("segmented forearm shell", (side * 0.45, -0.37, 1.10), (0.22, 0.29, 0.15), ARMOR, 0.022,
            (0, side * 0.12, 0))
        box("gauntlet wrist seal", (side * 0.34, -0.52, 1.01), (0.19, 0.13, 0.13), RUBBER, 0.02)
        box("fingered glove palm", (side * 0.31, -0.59, 1.00), (0.17, 0.17, 0.11), GUNMETAL, 0.028)
        for finger in range(3):
            box("glove finger segment", (side * (0.25 + finger * 0.05), -0.68, 0.98),
                (0.045, 0.10, 0.055), RUBBER, 0.008)
        leg_x = side * 0.20
        tube("pressure suit thigh", (leg_x, 0.01, 0.97), (leg_x, -0.05, 0.56), 0.15, FABRIC)
        panel("thigh front armor panel", (leg_x, -0.18, 0.77), 0.255, 0.34, 0.115, ARMOR, 0.16)
        box("thigh side attachment", (side * 0.35, 0.005, 0.76), (0.10, 0.16, 0.26), GUNMETAL, 0.016)
        for z in (0.55, 0.585, 0.62):
            box("knee flexible black seam", (leg_x, -0.08, z), (0.21, 0.19, 0.012), RUBBER, 0)
        box("angular knee shield", (leg_x, -0.18, 0.53), (0.27, 0.14, 0.17), ARMOR_LIGHT, 0.038)
        tube("shin fabric", (leg_x, -0.08, 0.50), (leg_x, -0.13, 0.21), 0.126, FABRIC)
        panel("shin high hardplate", (leg_x, -0.23, 0.35), 0.24, 0.25, 0.11, ARMOR, 0.22)
        box("heavy ankle seal", (leg_x, -0.14, 0.20), (0.24, 0.25, 0.15), RUBBER, 0.023)
        box("heavy pressure boot", (leg_x, -0.24, 0.11), (0.275, 0.42, 0.19), GUNMETAL, 0.035)
        box("steel boot toe armor", (leg_x, -0.41, 0.14), (0.27, 0.09, 0.10), ARMOR, 0.023)
        box("boot heel cleat", (leg_x, -0.10, 0.04), (0.25, 0.10, 0.05), RUBBER, 0)
        scuffs("arm shell", -0.255, side * 0.44, side * 0.59, 1.21, 1.59, 9)
        scuffs("thigh plate", -0.239, leg_x - 0.10, leg_x + 0.10, 0.63, 0.91, 11)


def rifle():
    root = bpy.data.objects.new("SEPARATE rifle pivot - rotate with aiming", None)
    bpy.context.collection.objects.link(root)
    before = set(bpy.context.scene.objects)
    box("rifle folded stock", (-0.27, -0.55, 1.075), (0.20, 0.12, 0.12), GUNMETAL, 0.017)
    box("rifle receiver housing", (0.05, -0.57, 1.10), (0.55, 0.16, 0.15), GUNMETAL, 0.017)
    box("rifle upper picatinny rail", (0.05, -0.57, 1.192), (0.44, 0.10, 0.03), ARMOR_LIGHT, 0.007)
    box("rifle barrel shroud", (0.37, -0.57, 1.105), (0.20, 0.12, 0.12), ARMOR, 0.015)
    tube("rifle bore", (0.44, -0.57, 1.10), (0.69, -0.57, 1.10), 0.032, SCUFF)
    box("rifle handguard vent", (0.36, -0.64, 1.115), (0.16, 0.01, 0.018), SCUFF, 0)
    box("rifle magazine", (-0.02, -0.59, 0.965), (0.15, 0.13, 0.19), ARMOR, 0.016)
    box("rifle amber safety mark", (0.16, -0.658, 1.135), (0.09, 0.008, 0.012), HAZARD, 0)
    for x in (-0.13, -0.02, 0.09, 0.20):
        box("rifle top rail notch", (x, -0.57, 1.215), (0.025, 0.11, 0.015), SCUFF, 0)
    for obj in set(bpy.context.scene.objects) - before:
        obj.parent = root
    return root


def camera(name, at, target, scale):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = at
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    data.type = "ORTHO"
    data.ortho_scale = scale
    return obj


def area(name, at, power, rgb, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = rgb
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = at
    obj.rotation_euler = (Vector((0, 0, 1.2)) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render(file, view):
    bpy.context.scene.camera = view
    bpy.context.scene.render.filepath = file
    bpy.ops.render.render(write_still=True)


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--output", required=True)
    parsed = args.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    os.makedirs(parsed.output, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    body = bpy.data.objects.new("CREW V1 editable body root", None)
    bpy.context.collection.objects.link(body)
    before = set(bpy.context.scene.objects)
    torso()
    limbs()
    backpack()
    helmet()
    for obj in set(bpy.context.scene.objects) - before:
        obj.parent = body
    rifle()

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
    area("large cold corridor light", (2.8, -3.5, 5.3), 480, (0.77, 0.86, 1.0), 3.2)
    area("warm maintenance rim", (-2.7, 2.4, 4.0), 220, (1.0, 0.67, 0.38), 2.4)
    area("soft front reflection", (-1.0, -3.0, 2.8), 80, (0.62, 0.80, 1.0), 1.5)
    top = camera("true vertical overhead camera", (0, 0, 8), (0, 0, 1.1), 2.85)
    quarter = camera("three quarter visual inspection camera", (3.1, -5.8, 3.0), (0, 0, 1.1), 3.05)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(parsed.output, "crew-v1.blend"))
    render(os.path.join(parsed.output, "crew-v1-top.png"), top)
    render(os.path.join(parsed.output, "crew-v1-threequarter.png"), quarter)


if __name__ == "__main__":
    main()
