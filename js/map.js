/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Map and Environment Manager (Layout, Scrap, Collision Tracing)
 */

class MapManager {
  constructor() {
    this.reset();
  }

  /**
   * Resets all environment structures, doors, and scrap elements to initial state
   */
  reset() {
    // Generate solid boundary & quadrant partitioning walls
    this.walls = [
      { x: 0, y: 0, w: Config.WORLD_W, h: 22 },
      { x: 0, y: Config.WORLD_H - 22, w: Config.WORLD_W, h: 22 },
      { x: 0, y: 0, w: 22, h: Config.WORLD_H },
      { x: Config.WORLD_W - 22, y: 0, w: 22, h: Config.WORLD_H },
      ...Config.quadrantOffsets.flatMap(offset => 
        Config.roomWalls.map(wall => ({ ...wall, x: wall.x + offset.x, y: wall.y + offset.y }))
      ),
      ...Config.irregularLayout,
      ...Config.connectorWalls
    ];

    // Generate door objects
    this.doors = Config.quadrantOffsets.flatMap(offset => 
      Config.baseDoors.map(door => ({ ...door, x: door.x + offset.x, y: door.y + offset.y, open: false }))
    );

    // Generate window elements
    this.windows = Config.quadrantOffsets.flatMap(offset => 
      Config.baseWindows.map(item => ({ ...item, x: item.x + offset.x, y: item.y + offset.y }))
    );

    // Generate scrap items
    this.scrap = Config.quadrantOffsets.flatMap(offset => 
      Config.baseScrap.map(item => {
        // Randomize loot type
        const keys = Object.keys(Config.items);
        const type = keys[Math.floor(Math.random() * keys.length)];
        const itemData = Config.items[type];
        return { 
          ...item, 
          x: item.x + offset.x, 
          y: item.y + offset.y, 
          found: false,
          name: itemData.name,
          value: itemData.baseValue,
          size: itemData.size
        };
      })
    );

    // Generate expansion room markers
    this.worldRooms = Config.quadrantOffsets.flatMap(offset => 
      Config.expansionRooms.map(room => ({ ...room, x: room.x + offset.x, y: room.y + offset.y }))
    );
  }

  /**
   * Checks if a circular entity collides with walls or closed doors
   */
  blocked(x, y, padding = 10) {
    // Check world outer boundary limit
    if (x < 22 + padding || x > Config.WORLD_W - 22 - padding || 
        y < 22 + padding || y > Config.WORLD_H - 22 - padding) {
      return true;
    }

    // Check closed doors
    const hitsDoor = this.doors.some(door => 
      !door.open && 
      x > door.x - padding && x < door.x + door.w + padding && 
      y > door.y - padding && y < door.y + door.h + padding
    );
    if (hitsDoor) return true;

    // Check solid walls
    return this.walls.some(w => 
      x > w.x - padding && x < w.x + w.w + padding && 
      y > w.y - padding && y < w.y + w.h + padding
    );
  }

  /**
   * Solves AABB-Ray intersection to determine distances to nearest occluding wall
   */
  rayWallDistance(originX, originY, directionX, directionY, maxDistance) {
    let nearest = maxDistance;
    
    for (const wall of this.walls) {
      const inverseX = directionX === 0 ? Infinity : 1 / directionX;
      const inverseY = directionY === 0 ? Infinity : 1 / directionY;

      const t1 = (wall.x - originX) * inverseX;
      const t2 = (wall.x + wall.w - originX) * inverseX;
      const t3 = (wall.y - originY) * inverseY;
      const t4 = (wall.y + wall.h - originY) * inverseY;

      const nearX = Math.min(t1, t2);
      const farX = Math.max(t1, t2);
      const nearY = Math.min(t3, t4);
      const farY = Math.max(t3, t4);

      const near = Math.max(nearX, nearY);
      const far = Math.min(farX, farY);

      if (far >= Math.max(0, near) && near < nearest) {
        nearest = Math.max(0, near);
      }
    }
    
    return nearest;
  }
}
