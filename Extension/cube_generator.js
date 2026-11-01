/**
 * OpenFishTools Extension - Cube Generator Card (.js)
 * 100% Self-Contained Extension: UI + 6-Sided 3D Procedural Cube Rig Engine.
 */
Card({
  id: 'cube_generator',
  name: 'Cube Generator',
  icon: 'view_in_ar',
  description: 'Generator kubus 3D berdasarkan dimensi Width, Height, Depth, atau ukuran layer terpilih.',
  category: '3D',
  defaultEnabled: true,

  // ============================================================================
  // 1. LOGIKA ALGORITMA 3D CUBE GENERATOR (6-SIDED 3D RIG + PRECOMP)
  // ============================================================================
  createCube(ctx, w, h, d, useLayer = false) {
    if (w && typeof w === 'object' && !Array.isArray(w)) {
      const opts = w;
      w = opts.width ?? opts.w;
      h = opts.height ?? opts.h;
      d = opts.depth ?? opts.d;
      useLayer = Boolean(opts.useLayer);
    }

    const layers = ctx.layers.getAll();
    const selLayer = ctx.layers.getActive();
    const { startSec, durationSec, pps } = ctx.scene3d.getTiming(selLayer);

    let boxW = parseFloat(w);
    if (isNaN(boxW) || boxW <= 0) boxW = 400;
    let boxH = parseFloat(h);
    if (isNaN(boxH) || boxH <= 0) boxH = 400;
    let boxD = parseFloat(d);
    if (isNaN(boxD) || boxD <= 0) boxD = 400;

    let textureLayer = null;
    let shouldReplace = false;

    if (selLayer && (selLayer.dataUrl || selLayer.mediaId || selLayer.type === 'image' || selLayer.type === 'video' || useLayer)) {
      textureLayer = selLayer;
      if (useLayer) {
        boxW = selLayer.scaleW || selLayer.mediaWidth || 400;
        boxH = selLayer.scaleH || selLayer.mediaHeight || 400;
        boxD = Math.min(boxW, boxH);
        shouldReplace = true;
      }
    }

    const halfW = boxW / 2;
    const halfH = boxH / 2;
    const halfD = boxD / 2;

    const cubeCompW = Math.round(boxW);
    const cubeCompH = Math.round(boxH);

    // Root Controller (starts at 0 in precomp local timeline)
    const controller = ctx.scene3d.create3DNull({
      name: 'Cube_Controller',
      pos: [cubeCompW / 2, cubeCompH / 2, 0],
      ori: [0, 0, 0],
      startSec: 0,
      durationSec,
      pps
    });

    // 6 Shaded Faces (Textured with selected layer if available)
    const cFront = '#9e9e9e';
    const cBack = '#616161';
    const cLeft = '#757575';
    const cRight = '#8d8d8d';
    const cTop = '#bdbdbd';
    const cBottom = '#424242';

    const faces = [
      ctx.scene3d.create3DFace({
        name: 'Cube_Front',
        w: boxW,
        h: boxH,
        pos: [0, 0, -halfD],
        ori: [0, 0, 0],
        parent: controller,
        color: cFront,
        textureLayer,
        startSec: 0,
        durationSec,
        pps
      }),
      ctx.scene3d.create3DFace({
        name: 'Cube_Back',
        w: boxW,
        h: boxH,
        pos: [0, 0, halfD],
        ori: [0, 180, 0],
        parent: controller,
        color: cBack,
        textureLayer,
        startSec: 0,
        durationSec,
        pps
      }),
      ctx.scene3d.create3DFace({
        name: 'Cube_Left',
        w: boxD,
        h: boxH,
        pos: [-halfW, 0, 0],
        ori: [0, -90, 0],
        parent: controller,
        color: cLeft,
        textureLayer,
        startSec: 0,
        durationSec,
        pps
      }),
      ctx.scene3d.create3DFace({
        name: 'Cube_Right',
        w: boxD,
        h: boxH,
        pos: [halfW, 0, 0],
        ori: [0, 90, 0],
        parent: controller,
        color: cRight,
        textureLayer,
        startSec: 0,
        durationSec,
        pps
      }),
      ctx.scene3d.create3DFace({
        name: 'Cube_Top',
        w: boxW,
        h: boxD,
        pos: [0, -halfH, 0],
        ori: [90, 0, 0],
        parent: controller,
        color: cTop,
        textureLayer,
        startSec: 0,
        durationSec,
        pps
      }),
      ctx.scene3d.create3DFace({
        name: 'Cube_Bottom',
        w: boxW,
        h: boxD,
        pos: [0, halfH, 0],
        ori: [-90, 0, 0],
        parent: controller,
        color: cBottom,
        textureLayer,
        startSec: 0,
        durationSec,
        pps
      })
    ];

    const childLayers = [controller, ...faces];
    const cubeCount = layers.filter(l => l.name && l.name.startsWith('Cube_Comp')).length + 1;
    const precompName = cubeCount > 1 ? `Cube_Comp ${cubeCount}` : 'Cube_Comp';

    return ctx.scene3d.wrapIn3DPrecomp({
      name: precompName,
      compW: cubeCompW,
      compH: cubeCompH,
      startSec,
      durationSec,
      childLayers,
      replaceLayer: shouldReplace ? selLayer : null,
      pps
    });
  },

  tools: {
    CUBE(ctx, w, h, d, useLayer) { return this.createCube(ctx, w, h, d, useLayer); },
    CREATE_CUBE(ctx, w, h, d, useLayer) { return this.createCube(ctx, w, h, d, useLayer); }
  },

  // ============================================================================
  // 2. TAMPILAN UI EXTENSION CARD
  // ============================================================================
  build(ui, ctx) {
    const self = this;
    ui.section('Cube Dimensions');

    let widthVal = 100;
    let heightVal = 100;
    let depthVal = 100;
    let useLayerDimensions = false;

    ui.formRow([
      (subUI) => {
        subUI.formGroup({
          label: 'WIDTH',
          type: 'number',
          value: 100,
          onChange(v) { widthVal = parseFloat(v) || 100; }
        });
      },
      (subUI) => {
        subUI.formGroup({
          label: 'HEIGHT',
          type: 'number',
          value: 100,
          onChange(v) { heightVal = parseFloat(v) || 100; }
        });
      },
      (subUI) => {
        subUI.formGroup({
          label: 'DEPTH',
          type: 'number',
          value: 100,
          onChange(v) { depthVal = parseFloat(v) || 100; }
        });
      }
    ]);

    ui.switch({
      id: 'cube-use-layer-toggle',
      label: 'Use Layer Dimensions',
      checked: false,
      onChange(checked) {
        useLayerDimensions = !!checked;
      }
    });

    ui.button({
      label: 'CREATE CUBE',
      icon: 'view_in_ar',
      title: 'Generate 6-sided 3D Cube',
      className: 'w-full tool-btn-primary',
      onClick() {
        self.createCube(ctx, {
          width: widthVal,
          height: heightVal,
          depth: depthVal,
          useLayer: useLayerDimensions
        });
      }
    });
  }
});
