/**
 * OpenFishTools Extension - 3D Generator Card
 * Provides: 3D scene generators (Basic 3D, Devices & Tech, Room & Furniture, Props & Character).
 */
Card({
  id: 'generator_3d',
  name: '3D Generator',
  icon: 'view_in_ar',
  description: 'Basic 3D, Devices & Tech (Phone, Laptop, Monitor), Room & Furniture, Props & Character.',
  category: '3D',
  defaultEnabled: true,

  build(ui, ctx) {
    ui.section('Basic 3D');
    ui.grid({ cols: 3 }, [
      ui.button({ label: '3 SPLIT', icon: 'view_column', title: '3D 3-Split Columns', onClick() { ctx.runTool('GEN_3D_3SPLIT'); } }),
      ui.button({ label: '2 SPLIT', icon: 'view_stream', title: '3D 2-Split Screens', onClick() { ctx.runTool('GEN_3D_2SPLIT'); } }),
      ui.button({ label: 'TUNNEL', icon: 'filter_tilt_shift', title: '3D Depth Tunnel', onClick() { ctx.runTool('GEN_3D_TUNNEL'); } })
    ]);

    ui.section('Devices & Tech');
    ui.grid({ cols: 4 }, [
      ui.button({ label: 'PHONE', icon: 'smartphone', title: '3D Smartphone Mockup', onClick() { ctx.runTool('GEN_3D_PHONE'); } }),
      ui.button({ label: 'Z FLIP', icon: 'mobile_friendly', title: '3D Flip Phone Fold', onClick() { ctx.runTool('GEN_3D_ZFLIP'); } }),
      ui.button({ label: 'Z FOLD', icon: 'menu_book', title: '3D Foldable Tablet/Phone', onClick() { ctx.runTool('GEN_3D_ZFOLD'); } }),
      ui.button({ label: 'TABLET', icon: 'tablet_mac', title: '3D Tablet Frame', onClick() { ctx.runTool('GEN_3D_TABLET'); } }),
      ui.button({ label: 'LAPTOP', icon: 'laptop_mac', title: '3D Laptop with Screen', onClick() { ctx.runTool('GEN_3D_LAPTOP'); } }),
      ui.button({ label: 'MONITOR', icon: 'desktop_windows', title: '3D Desktop Monitor', onClick() { ctx.runTool('GEN_3D_MONITOR'); } }),
      ui.button({ label: 'PC TOWER', icon: 'computer', title: '3D PC Computer Case', onClick() { ctx.runTool('GEN_3D_PC'); } }),
      ui.button({ label: 'CRT TV', icon: 'tv', title: '3D Retro CRT Television', onClick() { ctx.runTool('GEN_3D_CRT'); } })
    ]);

    ui.section('Room & Furniture');
    ui.grid({ cols: 3 }, [
      ui.button({ label: 'ROOM', icon: 'roofing', title: '3D Isometric Room Box', onClick() { ctx.runTool('GEN_3D_ROOM'); } }),
      ui.button({ label: 'DOOR', icon: 'door_front', title: '3D Hinged Door', onClick() { ctx.runTool('GEN_3D_DOOR'); } }),
      ui.button({ label: 'WINDOW', icon: 'window', title: '3D Window Pane', onClick() { ctx.runTool('GEN_3D_WINDOW'); } }),
      ui.button({ label: 'TABLE', icon: 'table_restaurant', title: '3D Table Surface', onClick() { ctx.runTool('GEN_3D_TABLE'); } }),
      ui.button({ label: 'DESK', icon: 'desk', title: '3D Office Desk', onClick() { ctx.runTool('GEN_3D_DESK'); } }),
      ui.button({ label: 'CABINET', icon: 'inventory_2', title: '3D Storage Cabinet', onClick() { ctx.runTool('GEN_3D_CABINET'); } })
    ]);

    ui.section('Props & Character');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'BOX', icon: 'view_in_ar', title: '3D Parcel Box', onClick() { ctx.runTool('GEN_3D_BOX'); } }),
      ui.button({ label: 'BOOK', icon: 'auto_stories', title: '3D Book Cover & Pages', onClick() { ctx.runTool('GEN_3D_BOOK'); } }),
      ui.button({ label: 'BINDER', icon: 'folder_special', title: '3D Office Binder', onClick() { ctx.runTool('GEN_3D_BINDER'); } }),
      ui.button({ label: 'GLASSES', icon: 'visibility', title: '3D Glasses Frame', onClick() { ctx.runTool('GEN_3D_GLASSES'); } }),
      ui.button({ label: 'MC 3D', icon: 'accessibility_new', title: '3D Minecraft Character Rig', onClick() { ctx.runTool('GEN_3D_MC'); } })
    ]);
  }
});
