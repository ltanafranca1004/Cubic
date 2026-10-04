#!/usr/bin/env python3
"""
Generate 8-bit turtle sprite sheets for Cubic game.
Creates 64x16 sprite sheets (4 frames of 16x16) for outside and inside turtles.
Frame 0: Idle pose
Frame 1: Walk down
Frame 2: Walk up
Frame 3: Walk right (left is achieved by horizontal flip)
"""

import json
import os
from typing import Dict, List, Tuple

# Try to import PIL, if not available, create simple placeholder files
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("Warning: PIL not available, creating placeholder files")


# Color palettes for the two turtles
OUTSIDE_TURTLE = {
    'skin': '#7CFC00',      # Lawn green (bright green explorer)
    'shell_light': '#FFD700', # Gold (gem on shell)
    'shell_dark': '#B8860B',  # Dark gold
    'eye_white': '#FFFFFF',
    'eye_black': '#000000',
    'accent': '#FF4500',    # Orange red for impact sparks
}

INSIDE_TURTLE = {
    'skin': '#008080',      # Dark teal
    'shell_light': '#9370DB', # Purple (medium purple)
    'shell_dark': '#4B0082',  # Indigo (dark purple)
    'eye_white': '#FFFFFF',
    'eye_black': '#00FFFF',   # Cyan/glowing yellow eyes (actually cyan for visibility)
    'accent': '#FFFF00',    # Yellow for impact sparks
    'moon_glow': '#F0F8FF', # Alice blue (pale moon gem)
}

# Background color (transparent)
BG_COLOR = (0, 0, 0, 0)  # RGBA for transparency

def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def create_base_turtle_outside() -> List[List[Tuple[int, int, int, int]]]:
    """Create base 16x16 outside turtle sprite (facing down)."""
    # Create transparent canvas
    img = [[BG_COLOR for _ in range(16)] for _ in range(16)]

    if not HAS_PIL:
        return img

    # Convert colors
    skin = hex_to_rgb(OUTSIDE_TURTLE['skin'])
    shell_light = hex_to_rgb(OUTSIDE_TURTLE['shell_light'])
    shell_dark = hex_to_rgb(OUTSIDE_TURTLE['shell_dark'])
    eye_white = hex_to_rgb(OUTSIDE_TURTLE['eye_white'])
    eye_black = hex_to_rgb(OUTSIDE_TURTLE['eye_black'])
    accent = hex_to_rgb(OUTSIDE_TURTLE['accent'])

    # Simple turtle shape (this is a basic placeholder - in reality you'd want to design this properly)
    # Shell (oval shape)
    for y in range(4, 12):
        for x in range(3, 13):
            if (x-8)**2 / 25 + (y-8)**2 / 16 <= 1:  # Ellipse equation
                img[y][x] = shell_light + (255,)

    # Head (circle)
    for y in range(2, 6):
        for x in range(6, 10):
            if (x-8)**2 + (y-4)**2 <= 4:
                img[y][x] = skin + (255,)

    # Eyes
    img[3][7] = eye_white + (255,)  # Left eye
    img[3][8] = eye_black + (255,)  # Left pupil
    img[3][10] = eye_white + (255,) # Right eye
    img[3][11] = eye_black + (255,) # Right pupil

    # Front flippers (legs)
    for y in range(9, 13):
        for x in range(5, 8):
            img[y][x] = skin + (255,)  # Left front flipper
        for x in range(9, 12):
            img[y][x] = skin + (255,)  # Right front flipper

    # Back flippers (legs)
    for y in range(12, 15):
        for x in range(5, 8):
            img[y][x] = skin + (255,)  # Left back flipper
        for x in range(9, 12):
            img[y][x] = skin + (255,)  # Right back flipper

    # Shell details (scutes)
    for y in range(5, 11, 2):
        for x in range(4, 12, 2):
            img[y][x] = shell_dark + (255,)

    return img

def create_base_turtle_inside() -> List[List[Tuple[int, int, int, int]]]:
    """Create base 16x16 inside turtle sprite (facing down)."""
    # Create transparent canvas
    img = [[BG_COLOR for _ in range(16)] for _ in range(16)]

    if not HAS_PIL:
        return img

    # Convert colors
    skin = hex_to_rgb(INSIDE_TURTLE['skin'])
    shell_light = hex_to_rgb(INSIDE_TURTLE['shell_light'])
    shell_dark = hex_to_rgb(INSIDE_TURTLE['shell_dark'])
    eye_white = hex_to_rgb(INSIDE_TURTLE['eye_white'])
    eye_black = hex_to_rgb(INSIDE_TURTLE['eye_black'])
    accent = hex_to_rgb(INSIDE_TURTLE['accent'])
    moon_glow = hex_to_rgb(INSIDE_TURTLE['moon_glow'])

    # Simple turtle shape (placeholder)
    # Shell (oval shape)
    for y in range(4, 12):
        for x in range(3, 13):
            if (x-8)**2 / 25 + (y-8)**2 / 16 <= 1:  # Ellipse equation
                img[y][x] = shell_light + (255,)

    # Head (circle)
    for y in range(2, 6):
        for x in range(6, 10):
            if (x-8)**2 + (y-4)**2 <= 4:
                img[y][x] = skin + (255,)

    # Eyes (glowing)
    img[3][7] = eye_white + (255,)  # Left eye
    img[3][8] = eye_black + (255,)  # Left pupil
    img[3][10] = eye_white + (255,) # Right eye
    img[3][11] = eye_black + (255,) # Right pupil

    # Front flippers (legs)
    for y in range(9, 13):
        for x in range(5, 8):
            img[y][x] = skin + (255,)  # Left front flipper
        for x in range(9, 12):
            img[y][x] = skin + (255,)  # Right front flipper

    # Back flippers (legs)
    for y in range(12, 15):
        for x in range(5, 8):
            img[y][x] = skin + (255,)  # Left back flipper
        for x in range(9, 12):
            img[y][x] = skin + (255,)  # Right back flipper

    # Shell details (scutes)
    for y in range(5, 11, 2):
        for x in range(4, 12, 2):
            img[y][x] = shell_dark + (255,)

    # Moon gem on shell
    img[7][8] = moon_glow + (255,)
    img[7][9] = moon_glow + (255,)
    img[8][8] = moon_glow + (255,)
    img[8][9] = moon_glow + (255,)

    return img

def shift_pixels(img: List[List[Tuple[int, int, int, int]]], dx: float, dy: float) -> List[List[Tuple[int, int, int, int]]]:
    """Shift image pixels by dx, dy (positive = right/down)."""
    height = len(img)
    width = len(img[0]) if height > 0 else 0
    new_img = [[BG_COLOR for _ in range(width)] for _ in range(height)]

    for y in range(height):
        for x in range(width):
            new_x = round(x + dx)
            new_y = round(y + dy)
            if 0 <= new_x < width and 0 <= new_y < height:
                new_img[new_y][new_x] = img[y][x]

    return new_img

def create_sprite_sheet(frames: List[List[List[Tuple[int, int, int, int]]]],
                       filename: str) -> None:
    """Create and save sprite sheet from frames."""
    if not frames:
        return

    if not HAS_PIL:
        # Create a simple text file placeholder
        placeholder_path = filename.replace('.png', '.txt')
        with open(placeholder_path, 'w') as f:
            f.write(f"Placeholder for {filename}\n")
            f.write(f"This should be a {len(frames[0])}x{len(frames[0][0])} sprite sheet with {len(frames)} frames\n")
            f.write("Install PIL (Pillow) to generate actual PNG files:\n")
            f.write("pip install Pillow\n")
        print(f"Created placeholder: {placeholder_path}")
        return

    # Convert frames to PIL Images
    pil_frames = []
    for frame in frames:
        img = Image.new('RGBA', (len(frame[0]), len(frame)), BG_COLOR)
        pixels = []
        for row in frame:
            pixels.extend(row)
        img.putdata(pixels)
        pil_frames.append(img)

    # Create sprite sheet (frames in a row)
    frame_width = pil_frames[0].width
    frame_height = pil_frames[0].height
    sheet_width = frame_width * len(pil_frames)
    sheet_height = frame_height

    sprite_sheet = Image.new('RGBA', (sheet_width, sheet_height), BG_COLOR)

    for i, frame in enumerate(pil_frames):
        sprite_sheet.paste(frame, (i * frame_width, 0))

    # Save the file
    sprite_sheet.save(filename)
    print(f"Generated: {filename}")

def create_turtle_animations() -> Dict[str, Dict]:
    """Create animation definitions for turtles."""
    animations = {
        # Outside turtle animations
        'outside_idle_breathe': {
            'row': 0,
            'frames': 2,
            'frame_time': [500, 500],  # 500ms each for breathing
            'loop': True
        },
        'outside_idle_blink': {
            'row': 1,
            'frames': 3,
            'frame_time': [300, 100, 300],  # Blink pattern
            'loop': True
        },
        'outside_idle_look_around': {
            'row': 2,
            'frames': 4,
            'frame_time': [200, 200, 200, 200],  # Look left, center, right, center
            'loop': True
        },
        'outside_idle_shell_tuck': {
            'row': 3,
            'frames': 5,
            'frame_time': [150, 150, 200, 150, 150],  # Tuck in, hold, peek out, pop back
            'loop': False
        },
        'outside_idle_knock_knock': {
            'row': 4,
            'frames': 4,
            'frame_time': [100, 50, 100, 50],  # Tap-tap with sparks
            'loop': False
        },
        'outside_idle_sleep': {
            'row': 5,
            'frames': 3,
            'frame_time': [400, 400, 400],  # Eyes closed, breathing, Z floats up
            'loop': True
        },
        'outside_walk_down': {
            'row': 6,
            'frames': 4,
            'frame_time': [100, 100, 100, 100],
            'loop': True
        },
        'outside_walk_up': {
            'row': 7,
            'frames': 4,
            'frame_time': [100, 100, 100, 100],
            'loop': True
        },
        'outside_walk_right': {
            'row': 8,
            'frames': 4,
            'frame_time': [100, 100, 100, 100],
            'loop': True
        },
        # Outside walk left is mirror of right (handled in game)

        # Inside turtle animations
        'inside_idle_breathe': {
            'row': 9,
            'frames': 2,
            'frame_time': [500, 500],
            'loop': True
        },
        'inside_idle_blink': {
            'row': 10,
            'frames': 3,
            'frame_time': [300, 100, 300],
            'loop': True
        },
        'inside_idle_look_around': {
            'row': 11,
            'frames': 4,
            'frame_time': [200, 200, 200, 200],
            'loop': True
        },
        'inside_idle_shell_tuck': {
            'row': 12,
            'frames': 5,
            'frame_time': [150, 150, 200, 150, 150],
            'loop': False
        },
        'inside_idle_knock_knock': {
            'row': 13,
            'frames': 4,
            'frame_time': [100, 50, 100, 50],
            'loop': False
        },
        'inside_idle_sleep': {
            'row': 14,
            'frames': 3,
            'frame_time': [400, 400, 400],
            'loop': True
        },
        'inside_walk_down': {
            'row': 15,
            'frames': 4,
            'frame_time': [100, 100, 100, 100],
            'loop': True
        },
        'inside_walk_up': {
            'row': 16,
            'frames': 4,
            'frame_time': [100, 100, 100, 100],
            'loop': True
        },
        'inside_walk_right': {
            'row': 17,
            'frames': 4,
            'frame_time': [100, 100, 100, 100],
            'loop': True
        },
        # Inside walk left is mirror of right
    }

    return animations

def generate_turtle_sprite_sheets():
    """Generate all turtle sprite sheets and metadata."""
    print("Generating turtle sprite sheets...")

    # Create base turtles
    outside_base = create_base_turtle_outside()
    inside_base = create_base_turtle_inside()

    # Create 4-frame walk cycle strips (compatible with existing 64x16 player sprites)
    # Frame 0: Idle pose (breathe/blick default)
    # Frame 1: Walk down
    # Frame 2: Walk up
    # Frame 3: Walk right (left is achieved by horizontal flip in game)

    def create_walk_strip(base_pose):
        """Create a 4-frame walk strip from a base pose."""
        frames = []
        # Frame 0: Idle (base pose)
        frames.append(base_pose)
        # Frame 1: Walk down (shift down slightly, move legs)
        frame1 = shift_pixels(base_pose, 0, 1)  # slight down
        # Modify legs for walk pose - simplified
        frames.append(frame1)
        # Frame 2: Walk up (shift up slightly, move legs)
        frame2 = shift_pixels(base_pose, 0, -1)  # slight up
        # Modify legs for walk pose - simplified
        frames.append(frame2)
        # Frame 3: Walk right (shift right slightly, move legs)
        frame3 = shift_pixels(base_pose, 1, 0)  # slight right
        # Modify legs for walk pose - simplified
        frames.append(frame3)
        return frames

    # Create walk strips for both turtles
    outside_frames = create_walk_strip(outside_base)
    inside_frames = create_walk_strip(inside_base)

    # Create sprite sheets (horizontal strips of 4 frames each)
    if outside_frames:
        create_sprite_sheet(outside_frames,
                          '/Users/ken/Cubic/client/public/assets/sprites/turtle-outside.png')
    if inside_frames:
        create_sprite_sheet(inside_frames,
                          '/Users/ken/Cubic/client/public/assets/sprites/turtle-inside.png')

    # Create animation metadata JSON
    # Since we're using the existing format (4-frame strips), we'll simplify the JSON
    # to match what the game currently expects
    animations = {
        # Outside turtle animations
        'outside_idle': {
            'row': 0,  # Not used in strip format, but kept for compatibility
            'frame': 0,  # First frame is idle
            'frame_time': 1000,  # 1 second per frame for idle
            'loop': True
        },
        'outside_walk_down': {
            'row': 0,
            'frame': 1,
            'frame_time': 100,  # 100ms per frame for walking
            'loop': True
        },
        'outside_walk_up': {
            'row': 0,
            'frame': 2,
            'frame_time': 100,
            'loop': True
        },
        'outside_walk_right': {
            'row': 0,
            'frame': 3,
            'frame_time': 100,
            'loop': True
        },
        # Outside walk left is handled by flipping the right frame horizontally

        # Inside turtle animations
        'inside_idle': {
            'row': 0,
            'frame': 0,
            'frame_time': 1000,
            'loop': True
        },
        'inside_walk_down': {
            'row': 0,
            'frame': 1,
            'frame_time': 100,
            'loop': True
        },
        'inside_walk_up': {
            'row': 0,
            'frame': 2,
            'frame_time': 100,
            'loop': True
        },
        'inside_walk_right': {
            'row': 0,
            'frame': 3,
            'frame_time': 100,
            'loop': True
        },
        # Inside walk left is handled by flipping the right frame horizontally
    }

    # Add metadata
    metadata = {
        'description': 'Turtle sprite sheets for Cubic game (compatible format)',
        'version': '1.0',
        'frame_size': [16, 16],
        'sheet_format': 'horizontal_strip_4_frames',  # 4 frames in a row
        'outside_turtle_sheet': 'turtle-outside.png',
        'inside_turtle_sheet': 'turtle-inside.png',
        'palette_outside': OUTSIDE_TURTLE,
        'palette_inside': INSIDE_TURTLE,
        'animations': animations,
        'notes': 'Uses frame 0 for idle, frames 1-3 for walk down/up/right. Walk left is achieved by horizontal flip.'
    }

    # Save JSON file
    json_path = '/Users/ken/Cubic/client/public/assets/sprites/turtles.json'
    with open(json_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Generated: {json_path}")

    print("\nGeneration complete!")
    print("Files created:")
    print("  - client/public/assets/sprites/turtle-outside.png (64x16)")
    print("  - client/public/assets/sprites/turtle-inside.png (64x16)")
    print("  - client/public/assets/sprites/turtles.json")
    print("\nThese files can directly replace player-out.png and player-in.png")
    print("to use the turtle sprites in the game.")

if __name__ == '__main__':
    generate_turtle_sprite_sheets()