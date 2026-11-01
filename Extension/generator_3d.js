/**
 * OpenFishTools Extension - 3D Generator Card (.js)
 * 100% Self-Contained Extension: UI + 18 Procedural 3D Objects, 2/3-Split, Tunnel, and Minecraft Character Rig.
 */
Card({
  id: 'generator_3d',
  name: '3D Generator',
  icon: 'view_in_ar',
  description: 'Basic 3D, Devices & Tech (Phone, Laptop, Monitor), Room & Furniture, Props & Character.',
  category: '3D',
  defaultEnabled: true,

  // ============================================================================
  // 1. LOGIKA ALGORITMA 18 OBJEK 3D PROSEDURAL (BOX, CABINET, TABLE, PHONE, DLL)
  // ============================================================================
  createProcedural3D(ctx, type) {
    const typeUpper = (type || 'BOX').toUpperCase().replace('GEN_3D_', '');

    const typeNames = {
      BOX: '3D_Box',
      CABINET: '3D_Cabinet',
      TABLE: '3D_Table',
      PHONE: '3D_Phone',
      LAPTOP: '3D_Laptop',
      ROOM: '3D_Room',
      CRT: '3D_CRT_TV',
      ZFLIP: '3D_ZFlip',
      ZFOLD: '3D_ZFold',
      BOOK: '3D_Book',
      BINDER: '3D_Binder',
      TABLET: '3D_Tablet',
      GLASSES: '3D_Glasses',
      WINDOW: '3D_Window',
      DOOR: '3D_Door',
      DESK: '3D_Desk',
      MONITOR: '3D_Monitor',
      PC: '3D_PC_Tower'
    };

    const baseName = typeNames[typeUpper] || '3D_Object';
    const layers = ctx.layers.getAll();
    const selLayer = ctx.layers.getActive();
    const { startSec, durationSec, pps } = ctx.scene3d.getTiming(selLayer);
    const [baseW, baseH] = ctx.scene3d.getBaseDims();

    const compW = (selLayer && selLayer.scaleW && selLayer.scaleW > 0) ? Math.round(selLayer.scaleW) : baseW;
    const compH = (selLayer && selLayer.scaleH && selLayer.scaleH > 0) ? Math.round(selLayer.scaleH) : baseH;

    const controller = ctx.scene3d.create3DNull({
      name: `${baseName}_Controller`,
      pos: [compW / 2, compH / 2, 0],
      ori: [0, 0, 0],
      startSec,
      durationSec,
      pps
    });

    const childLayers = [controller];

    function addFace(name, w, h, pos, ori, parent, colorRgba, mult = 1.0, roundness = 0, texture = null, opacity = 1.0) {
      const color = ctx.scene3d.rgbaToHex(colorRgba, mult);
      const face = ctx.scene3d.create3DFace({
        name,
        w,
        h,
        pos,
        ori,
        parent: parent || controller,
        color,
        opacity,
        roundness,
        textureLayer: texture,
        startSec,
        durationSec,
        pps
      });
      childLayers.push(face);
      return face;
    }

    function addHinge(name, pos, ori, parent) {
      const hinge = ctx.scene3d.create3DNull({
        name,
        pos,
        ori,
        parent: parent || controller,
        startSec,
        durationSec,
        pps
      });
      childLayers.push(hinge);
      return hinge;
    }

    // --- Object Model Face Definitions ---
    if (typeUpper === 'BOX') {
      const cOuter = [0.82, 0.65, 0.44, 1.0];
      const cInner = [0.62, 0.46, 0.28, 1.0];
      const bW = (selLayer && selLayer.scaleW > 200) ? Math.min(selLayer.scaleW, 700) : 500;
      const bH = (selLayer && selLayer.scaleH > 200) ? Math.min(selLayer.scaleH, 700) : 500;
      const bD = Math.min(bW, bH);
      const hW = bW / 2, hH = bH / 2, hD = bD / 2;

      addFace('Bottom', bW, bD, [0, hH, 0], [90, 0, 0], controller, cInner, 0.65);
      addFace('Front', bW, bH, [0, 0, -hD], [0, 0, 0], controller, cOuter, 1.0, 0, selLayer);
      addFace('Back', bW, bH, [0, 0, hD], [0, 180, 0], controller, cOuter, 0.7);
      addFace('Left', bD, bH, [-hW, 0, 0], [0, -90, 0], controller, cOuter, 0.75);
      addFace('Right', bD, bH, [hW, 0, 0], [0, 90, 0], controller, cOuter, 0.85);
      addFace('Inside_Front', bW - 2, bH - 2, [0, 0, -hD + 1], [0, 180, 0], controller, cInner, 0.55);
      addFace('Inside_Back', bW - 2, bH - 2, [0, 0, hD - 1], [0, 0, 0], controller, cInner, 0.5);
      addFace('Inside_Left', bD - 2, bH - 2, [-hW + 1, 0, 0], [0, 90, 0], controller, cInner, 0.45);
      addFace('Inside_Right', bD - 2, bH - 2, [hW - 1, 0, 0], [0, -90, 0], controller, cInner, 0.5);

      const flapH = bD * 0.48;
      const flapW = bW * 0.48;
      const hFront = addHinge('Flap_Front_Hinge', [0, -hH, -hD], [0, 0, 0]);
      addFace('Flap_Front', bW, flapH, [0, -flapH / 2, 0], [0, 0, 0], hFront, cOuter, 1.1);

      const hBack = addHinge('Flap_Back_Hinge', [0, -hH, hD], [0, 180, 0]);
      addFace('Flap_Back', bW, flapH, [0, -flapH / 2, 0], [0, 0, 0], hBack, cOuter, 0.8);

      const hLeft = addHinge('Flap_Left_Hinge', [-hW, -hH, 0], [0, -90, 0]);
      addFace('Flap_Left', bD, flapW, [0, -flapW / 2, 0], [0, 0, 0], hLeft, cOuter, 0.85);

      const hRight = addHinge('Flap_Right_Hinge', [hW, -hH, 0], [0, 90, 0]);
      addFace('Flap_Right', bD, flapW, [0, -flapW / 2, 0], [0, 0, 0], hRight, cOuter, 0.95);
    }
    else if (typeUpper === 'CABINET') {
      const cWood = [0.42, 0.28, 0.18, 1.0];
      const cDoor = [0.55, 0.38, 0.24, 1.0];
      const cMetal = [0.86, 0.76, 0.45, 1.0];
      const cShelf = [0.46, 0.31, 0.19, 1.0];
      const cW = 560, cH = 840, cD = 360;
      const hcW = cW / 2, hcH = cH / 2, hcD = cD / 2;

      addFace('Back_Wall', cW, cH, [0, 0, hcD], [0, 180, 0], controller, cWood, 0.7);
      addFace('Left_Side', cD, cH, [-hcW, 0, 0], [0, 90, 0], controller, cWood, 0.8);
      addFace('Right_Side', cD, cH, [hcW, 0, 0], [0, -90, 0], controller, cWood, 0.9);
      addFace('Top_Roof', cW, cD, [0, -hcH, 0], [-90, 0, 0], controller, cWood, 1.1);
      addFace('Bottom_Floor', cW, cD, [0, hcH, 0], [90, 0, 0], controller, cWood, 0.6);
      addFace('Middle_Shelf', cW - 12, cD - 12, [0, 0, 0], [-90, 0, 0], controller, cShelf, 0.95);

      const dW = cW / 2 - 6;
      const dH = cH - 16;
      const hLeftDoor = addHinge('Left_Door_Hinge', [-hcW + 3, 0, -hcD - 3], [0, 0, 0]);
      addFace('Left_Door', dW, dH, [dW / 2, 0, 0], [0, 0, 0], hLeftDoor, cDoor, 1.05, 0, selLayer);
      addFace('Left_Handle', 8, 80, [dW - 18, 0, -6], [0, 0, 0], hLeftDoor, cMetal, 1.0);

      const hRightDoor = addHinge('Right_Door_Hinge', [hcW - 3, 0, -hcD - 3], [0, 0, 0]);
      addFace('Right_Door', dW, dH, [-dW / 2, 0, 0], [0, 0, 0], hRightDoor, cDoor, 1.0);
      addFace('Right_Handle', 8, 80, [-dW + 18, 0, -6], [0, 0, 0], hRightDoor, cMetal, 1.0);

      const legSize = 36, legH = 50;
      const legPos = [
        [-hcW + 30, hcH + legH / 2, -hcD + 30],
        [hcW - 30, hcH + legH / 2, -hcD + 30],
        [-hcW + 30, hcH + legH / 2, hcD - 30],
        [hcW - 30, hcH + legH / 2, hcD - 30]
      ];
      for (let f = 0; f < 4; f++) {
        addFace(`Foot_${f + 1}`, legSize, legH, legPos[f], [0, 0, 0], controller, cMetal, 0.7);
      }
    }
    else if (typeUpper === 'TABLE') {
      const cTop = [0.55, 0.38, 0.24, 1.0];
      const cLegs = [0.20, 0.21, 0.24, 1.0];
      const cTrim = [0.46, 0.31, 0.19, 1.0];
      const tW = 860, tD = 560, tThick = 32, lH = 460, lW = 40;
      const htW = tW / 2, htD = tD / 2, htThick = tThick / 2;

      addFace('Top_Surface', tW, tD, [0, -htThick, 0], [-90, 0, 0], controller, cTop, 1.15, 0, selLayer);
      addFace('Bottom_Surface', tW, tD, [0, htThick, 0], [90, 0, 0], controller, cTop, 0.6);
      addFace('Front_Edge', tW, tThick, [0, 0, -htD], [0, 0, 0], controller, cTrim, 1.0);
      addFace('Back_Edge', tW, tThick, [0, 0, htD], [0, 180, 0], controller, cTrim, 0.75);
      addFace('Left_Edge', tD, tThick, [-htW, 0, 0], [0, -90, 0], controller, cTrim, 0.85);
      addFace('Right_Edge', tD, tThick, [htW, 0, 0], [0, 90, 0], controller, cTrim, 0.9);

      const legCoords = [
        [-htW + 45, htThick + lH / 2, -htD + 45],
        [htW - 45, htThick + lH / 2, -htD + 45],
        [-htW + 45, htThick + lH / 2, htD - 45],
        [htW - 45, htThick + lH / 2, htD - 45]
      ];
      for (let l = 0; l < 4; l++) {
        const lp = legCoords[l];
        addFace(`Leg_${l + 1}_F`, lW, lH, [lp[0], lp[1], lp[2] - lW / 2], [0, 0, 0], controller, cLegs, 1.0);
        addFace(`Leg_${l + 1}_B`, lW, lH, [lp[0], lp[1], lp[2] + lW / 2], [0, 180, 0], controller, cLegs, 0.7);
        addFace(`Leg_${l + 1}_L`, lW, lH, [lp[0] - lW / 2, lp[1], lp[2]], [0, -90, 0], controller, cLegs, 0.8);
        addFace(`Leg_${l + 1}_R`, lW, lH, [lp[0] + lW / 2, lp[1], lp[2]], [0, 90, 0], controller, cLegs, 0.9);
      }
    }
    else if (typeUpper === 'PHONE') {
      const cBody = [0.15, 0.16, 0.18, 1.0];
      const cFrame = [0.45, 0.47, 0.5, 1.0];
      const cBump = [0.12, 0.13, 0.15, 1.0];
      const cRing = [0.72, 0.74, 0.78, 1.0];
      const cBezel = [0.02, 0.02, 0.02, 1.0];

      let pW = 460, pH = 940;
      if (selLayer && selLayer.scaleH && selLayer.scaleH > 100) {
        pH = Math.round(selLayer.scaleH);
        pW = Math.round(selLayer.scaleW && selLayer.scaleW > 50 ? selLayer.scaleW : pH * (460 / 940));
      } else if (selLayer && selLayer.scaleW && selLayer.scaleW > 100) {
        pW = Math.round(selLayer.scaleW);
        pH = Math.round(pW * (940 / 460));
      }
      const pD = Math.max(14, Math.round(pW * 0.056));
      const hpW = pW / 2, hpH = pH / 2, hpD = pD / 2;

      addFace('Front_Bezel', pW, pH, [0, 0, hpD], [0, 0, 0], controller, cBezel, 1.0, 36);
      addFace('Screen_Display', pW - 20, pH - 20, [0, 0, hpD + 1], [0, 0, 0], controller, cBezel, 0.05, 32, selLayer);
      addFace('Dynamic_Island', Math.round(pW * 0.24), Math.round(pH * 0.028), [0, -hpH + Math.round(pH * 0.045), hpD + 2], [0, 0, 0], controller, cBezel, 1.0, 13);
      addFace('Back_Cover', pW, pH, [0, 0, -hpD], [0, 180, 0], controller, cBody, 1.0, 36);

      const camPlateW = Math.round(pW * 0.32), camPlateH = Math.round(pH * 0.16);
      const camX = -hpW + Math.round(camPlateW * 0.6), camY = -hpH + Math.round(camPlateH * 0.6), camZ = -hpD - 4;
      addFace('Camera_Island', camPlateW, camPlateH, [camX, camY, camZ], [0, 180, 0], controller, cBump, 1.0, 24);
      addFace('Lens_Top_Rim', Math.round(pW * 0.1), Math.round(pW * 0.1), [camX - Math.round(camPlateW * 0.17), camY - Math.round(camPlateH * 0.17), camZ - 4], [0, 180, 0], controller, cRing, 1.0, 23);
      addFace('Lens_Bottom_Rim', Math.round(pW * 0.1), Math.round(pW * 0.1), [camX - Math.round(camPlateW * 0.17), camY + Math.round(camPlateH * 0.18), camZ - 4], [0, 180, 0], controller, cRing, 1.0, 23);
      addFace('Lens_Right_Rim', Math.round(pW * 0.09), Math.round(pW * 0.09), [camX + Math.round(camPlateW * 0.22), camY, camZ - 4], [0, 180, 0], controller, cRing, 1.0, 21);

      addFace('Frame_Left', pD, pH, [-hpW, 0, 0], [0, -90, 0], controller, cFrame, 0.85);
      addFace('Vol_Up_Btn', 5, Math.round(pH * 0.06), [-hpW - 3, Math.round(-pH * 0.12), 0], [0, 0, 0], controller, cFrame, 1.2);
      addFace('Vol_Down_Btn', 5, Math.round(pH * 0.06), [-hpW - 3, Math.round(-pH * 0.04), 0], [0, 0, 0], controller, cFrame, 1.2);
      addFace('Action_Btn', 5, Math.round(pH * 0.03), [-hpW - 3, Math.round(-pH * 0.19), 0], [0, 0, 0], controller, cFrame, 1.3);
      addFace('Frame_Right', pD, pH, [hpW, 0, 0], [0, 90, 0], controller, cFrame, 0.95);
      addFace('Power_Btn', 5, Math.round(pH * 0.085), [hpW + 3, Math.round(-pH * 0.085), 0], [0, 0, 0], controller, cFrame, 1.2);
      addFace('Frame_Top', pW, pD, [0, -hpH, 0], [-90, 0, 0], controller, cFrame, 1.1);
      addFace('Frame_Bottom', pW, pD, [0, hpH, 0], [90, 0, 0], controller, cFrame, 0.7);
    }
    else if (typeUpper === 'LAPTOP') {
      const cAlum = [0.34, 0.36, 0.39, 1.0];
      const cKb = [0.08, 0.08, 0.10, 1.0];
      const cPad = [0.28, 0.30, 0.33, 1.0];
      const cBezelLap = [0.02, 0.02, 0.02, 1.0];
      const lW = 820, lD = 540, bH = 18, sH = 540, sD = 10;
      const hlW = lW / 2, hlD = lD / 2, hbH = bH / 2, hsH = sH / 2, hsD = sD / 2;
      const baseY = 80;
      const topY = baseY - hbH;

      addFace('Base_Top', lW, lD, [0, topY, 0], [-90, 0, 0], controller, cAlum, 1.05);
      addFace('Keyboard_Well', 680, 230, [0, topY - 0.5, 95], [-90, 0, 0], controller, cKb, 0.45);
      addFace('Keys_Function_Row', 650, 16, [0, topY - 1.5, 188], [-90, 0, 0], controller, cKb, 1.05);
      addFace('Keys_Numbers', 555, 22, [-45, topY - 1.5, 160], [-90, 0, 0], controller, cKb, 1.1);
      addFace('Keys_QWERTY', 475, 22, [-7, topY - 1.5, 130], [-90, 0, 0], controller, cKb, 1.1);
      addFace('Keys_ASDF', 450, 22, [-10, topY - 1.5, 100], [-90, 0, 0], controller, cKb, 1.1);
      addFace('Keys_ZXCV', 405, 22, [-7, topY - 1.5, 70], [-90, 0, 0], controller, cKb, 1.1);
      addFace('Key_Spacebar', 280, 22, [-20, topY - 1.5, 40], [-90, 0, 0], controller, cKb, 1.25);
      addFace('Trackpad', 290, 180, [0, topY - 0.8, -140], [-90, 0, 0], controller, cPad, 1.0, 8);

      addFace('Base_Bottom', lW, lD, [0, baseY + hbH, 0], [90, 0, 0], controller, cAlum, 0.65);
      addFace('Base_Front', lW, bH, [0, baseY, -hlD], [0, 0, 0], controller, cAlum, 1.0);
      addFace('Base_Back', lW, bH, [0, baseY, hlD], [0, 180, 0], controller, cAlum, 0.7);
      addFace('Base_Left', lD, bH, [-hlW, baseY, 0], [0, -90, 0], controller, cAlum, 0.85);
      addFace('Base_Right', lD, bH, [hlW, baseY, 0], [0, 90, 0], controller, cAlum, 0.95);

      const lidHinge = addHinge('Screen_Hinge', [0, baseY - hbH, hlD - 2], [0, 0, 0]);
      addFace('Screen_Bezel', lW, sH, [0, -hsH, hsD], [0, 0, 0], lidHinge, cBezelLap, 1.0, 16);
      addFace('Screen_Display', lW - 32, sH - 32, [0, -hsH, hsD + 1], [0, 0, 0], lidHinge, cBezelLap, 0.05, 12, selLayer);
      addFace('Screen_Back_Lid', lW, sH, [0, -hsH, -hsD], [0, 180, 0], lidHinge, cAlum, 1.0, 16);
      addFace('Logo_Plate', 44, 44, [0, -hsH, -hsD - 1], [0, 180, 0], lidHinge, cAlum, 1.4, 22);
    }
    else if (typeUpper === 'ROOM') {
      const cFloor = [0.58, 0.42, 0.28, 1.0];
      const cWall = [0.91, 0.90, 0.88, 1.0];
      const cCeiling = [0.96, 0.96, 0.97, 1.0];
      const cBase = [0.42, 0.28, 0.18, 1.0];
      const rW = 1000, rH = 800, rD = 1000;
      const hrW = rW / 2, hrH = rH / 2, hrD = rD / 2;

      addFace('Floor', rW, rD, [0, hrH, 0], [90, 0, 0], controller, cFloor, 1.0);
      addFace('Ceiling', rW, rD, [0, -hrH, 0], [-90, 0, 0], controller, cCeiling, 0.95);
      addFace('Back_Wall', rW, rH, [0, 0, hrD], [0, 180, 0], controller, cWall, 1.0, 0, selLayer);
      addFace('Left_Wall', rD, rH, [-hrW, 0, 0], [0, 90, 0], controller, cWall, 0.85);
      addFace('Right_Wall', rD, rH, [hrW, 0, 0], [0, -90, 0], controller, cWall, 0.9);
      addFace('Back_Baseboard', rW, 36, [0, hrH - 18, hrD - 2], [0, 180, 0], controller, cBase, 0.5);
      addFace('Left_Baseboard', rD, 36, [-hrW + 2, hrH - 18, 0], [0, 90, 0], controller, cBase, 0.5);
      addFace('Right_Baseboard', rD, 36, [hrW - 2, hrH - 18, 0], [0, -90, 0], controller, cBase, 0.5);
    }
    else if (typeUpper === 'CRT') {
      const cBody = [0.24, 0.25, 0.27, 1.0];
      const cBezel = [0.12, 0.13, 0.14, 1.0];
      const cKnob = [0.84, 0.86, 0.90, 1.0];
      const cAccent = [0.86, 0.35, 0.25, 1.0];
      const tW = 640, tH = 580, tD = 440;
      const htW = tW / 2, htH = tH / 2, htD = tD / 2;
      const sW = 540, sH = 360;
      const sY = -htH + 24 + sH / 2;

      addFace('Front_Face', tW, tH, [0, 0, htD], [0, 0, 0], controller, cBody, 1.0);
      addFace('Screen_Bezel', sW, sH, [0, sY, htD + 1], [0, 0, 0], controller, cBezel, 1.0, 48);
      addFace('Screen_Glass', sW - 36, sH - 36, [0, sY, htD + 3], [0, 0, 0], controller, cBezel, 0.05, 40, selLayer);

      const pW = 540, pH = 120;
      const pY = sY + sH / 2 + 16 + pH / 2;
      addFace('Control_Panel_Base', pW, pH, [0, pY, htD + 1], [0, 0, 0], controller, cBezel, 0.7);
      for (let g = 0; g < 4; g++) {
        addFace(`Speaker_Grille_${g + 1}`, 150, 8, [-165, pY - 30 + g * 20, htD + 2], [0, 0, 0], controller, cBezel, 0.15);
      }
      addFace('Brand_Badge', 60, 16, [0, pY - 24, htD + 3], [0, 0, 0], controller, cKnob, 1.1);
      addFace('Power_Button', 30, 30, [0, pY + 20, htD + 4], [0, 0, 0], controller, cAccent, 1.0);
      addFace('Tuning_Knob_1', 48, 48, [130, pY, htD + 6], [0, 0, 0], controller, cKnob, 1.05, 24);
      addFace('Tuning_Knob_2', 48, 48, [205, pY, htD + 6], [0, 0, 0], controller, cKnob, 1.05, 24);

      addFace('Back_Cover', tW, tH, [0, 0, -htD], [0, 180, 0], controller, cBody, 0.7);
      addFace('Top_Cover', tW, tD, [0, -htH, 0], [-90, 0, 0], controller, cBody, 1.1);
      addFace('Bottom_Floor', tW, tD, [0, htH, 0], [90, 0, 0], controller, cBody, 0.65);
      addFace('Left_Side', tD, tH, [-htW, 0, 0], [0, -90, 0], controller, cBody, 0.85);
      addFace('Right_Side', tD, tH, [htW, 0, 0], [0, 90, 0], controller, cBody, 0.95);
    }
    else if (typeUpper === 'ZFLIP') {
      const cBody = [0.18, 0.20, 0.24, 1.0];
      const cBezel = [0.02, 0.02, 0.02, 1.0];
      const cCover = [0.10, 0.11, 0.13, 1.0];
      const fW = 436, hH = 500, fD = 22;
      const hhH = hH / 2, hfD = fD / 2;

      addFace('Base_Back_Cover', fW, hH, [0, hhH, -hfD], [0, 180, 0], controller, cBody, 1.0);
      addFace('Base_Bezel', fW, hH, [0, hhH, hfD], [0, 0, 0], controller, cBezel, 1.0);
      addFace('Base_Inner_Display', 400, 489, [0, hhH, hfD + 1], [0, 0, 0], controller, cBezel, 0.05, 0, selLayer);

      const flipHinge = addHinge('Flip_Hinge', [0, 0, -hfD], [0, 0, 0]);
      addFace('Upper_Inner_Display', 400, 489, [0, -hhH, 1], [0, 0, 0], flipHinge, cBezel, 0.05);
      addFace('Upper_Bezel', fW, hH, [0, -hhH, 0], [0, 0, 0], flipHinge, cBezel, 1.0);
      addFace('Upper_Back_Cover', fW, hH, [0, -hhH, -fD], [0, 180, 0], flipHinge, cBody, 1.0);
      addFace('Cover_Display', 320, 332, [0, -hhH - 40, -fD - 2], [0, 180, 0], flipHinge, cCover, 1.1);
    }
    else if (typeUpper === 'ZFOLD') {
      const cBody = [0.16, 0.17, 0.20, 1.0];
      const cBezel = [0.02, 0.02, 0.02, 1.0];
      const cCover = [0.06, 0.07, 0.08, 1.0];
      const fH = 920, fD = 22, hW = 385;
      const hhW = hW / 2, hfD = fD / 2;

      addFace('Right_Back_Cover', hW, fH, [hhW, 0, -hfD], [0, 180, 0], controller, cBody, 1.0);
      addFace('Right_Bezel', hW, fH, [hhW, 0, hfD], [0, 0, 0], controller, cBezel, 1.0);
      addFace('Right_Inner_Display', 373, 896, [hhW, 0, hfD + 1], [0, 0, 0], controller, cBezel, 0.05, 0, selLayer);
      addFace('Cover_Display', 345, 884, [hhW, 0, -hfD - 2], [0, 180, 0], controller, cCover, 1.1);

      const foldHinge = addHinge('Fold_Hinge', [0, 0, -hfD], [0, 0, 0]);
      addFace('Left_Inner_Display', 373, 896, [-hhW, 0, 1], [0, 0, 0], foldHinge, cBezel, 0.05);
      addFace('Left_Bezel', hW, fH, [-hhW, 0, 0], [0, 0, 0], foldHinge, cBezel, 1.0);
      addFace('Left_Back_Cover', hW, fH, [-hhW, 0, -fD], [0, 180, 0], foldHinge, cBody, 1.0);
    }
    else if (typeUpper === 'BOOK') {
      const cCover = [0.14, 0.22, 0.36, 1.0];
      const cSpine = [0.10, 0.16, 0.26, 1.0];
      const cPages = [0.96, 0.95, 0.92, 1.0];
      const cRibbon = [0.72, 0.12, 0.16, 1.0];
      const bW = 600, bH = 860, bD = 84;
      const hbW = bW / 2, hbD = bD / 2;
      const pThick = bD - 10;

      addFace('Back_Cover', bW, bH, [0, 0, -hbD], [0, 180, 0], controller, cCover, 1.0);
      addFace('Spine', bD, bH, [-hbW, 0, 0], [0, -90, 0], controller, cSpine, 1.0);
      addFace('Pages_First_Page', bW - 24, bH - 24, [10, 0, hbD - 5], [0, 0, 0], controller, cPages, 1.0, 0, selLayer);
      addFace('Pages_Right_Edge', pThick, bH - 24, [hbW - 2, 0, 0], [0, 90, 0], controller, cPages, 0.88);
      addFace('Ribbon_Bookmark', 18, bH + 60, [hbW - 40, 25, hbD - 3], [0, 0, 0], controller, cRibbon, 1.1);

      const bookCoverHinge = addHinge('Cover_Hinge', [-hbW, 0, hbD], [0, 0, 0]);
      addFace('Front_Cover_Outside', bW, bH, [hbW, 0, 2], [0, 0, 0], bookCoverHinge, cCover, 1.05);
      addFace('Front_Cover_Inside', bW, bH, [hbW, 0, -2], [0, 180, 0], bookCoverHinge, cCover, 0.92);
    }
    else if (typeUpper === 'BINDER') {
      const cCover = [0.20, 0.38, 0.34, 1.0];
      const cRings = [0.88, 0.90, 0.92, 1.0];
      const cPaper = [0.98, 0.98, 0.97, 1.0];
      const bW = 620, bH = 880, bD = 80;
      const hbW = bW / 2, hbH = bH / 2, hbD = bD / 2;

      addFace('Back_Cover', bW, bH, [0, 0, -hbD], [0, 180, 0], controller, cCover, 1.0);
      addFace('Spine', bD, bH, [-hbW, 0, 0], [0, -90, 0], controller, cCover, 0.85);
      addFace('Paper_Sheet_Top', bW - 56, bH - 36, [20, 0, hbD - 18], [0, 0, 0], controller, cPaper, 1.0, 0, selLayer);

      for (let r = 0; r < 6; r++) {
        const ringY = -hbH + 110 + r * 130;
        addFace(`Binder_Ring_${r + 1}`, 32, 14, [-hbW + 36, ringY, 0], [0, 0, 0], controller, cRings, 1.25);
      }

      const binderHinge = addHinge('Cover_Hinge', [-hbW, 0, hbD], [0, 0, 0]);
      addFace('Front_Cover_Outside', bW, bH, [hbW, 0, 2], [0, 0, 0], binderHinge, cCover, 1.05);
    }
    else if (typeUpper === 'TABLET') {
      const cBody = [0.28, 0.30, 0.33, 1.0];
      const cBezel = [0.02, 0.02, 0.02, 1.0];
      const cFrame = [0.45, 0.47, 0.50, 1.0];
      let tW = 760, tH = 1040;
      if (selLayer && selLayer.scaleH && selLayer.scaleH > 100) {
        tH = Math.round(selLayer.scaleH);
        tW = Math.round(selLayer.scaleW && selLayer.scaleW > 50 ? selLayer.scaleW : tH * (760 / 1040));
      } else if (selLayer && selLayer.scaleW && selLayer.scaleW > 100) {
        tW = Math.round(selLayer.scaleW);
        tH = Math.round(tW * (1040 / 760));
      }
      const tD = Math.max(12, Math.round(tW * 0.024));
      const htW = tW / 2, htH = tH / 2, htD = tD / 2;

      addFace('Front_Bezel', tW, tH, [0, 0, htD], [0, 0, 0], controller, cBezel, 1.0, 28);
      addFace('Screen_Display', tW - 28, tH - 28, [0, 0, htD + 1], [0, 0, 0], controller, cBezel, 0.05, 24, selLayer);
      addFace('Back_Cover', tW, tH, [0, 0, -htD], [0, 180, 0], controller, cBody, 1.0, 28);
      addFace('Frame_Top', tW, tD, [0, -htH, 0], [-90, 0, 0], controller, cFrame, 1.1);
      addFace('Frame_Bottom', tW, tD, [0, htH, 0], [90, 0, 0], controller, cFrame, 0.7);
      addFace('Frame_Left', tD, tH, [-htW, 0, 0], [0, -90, 0], controller, cFrame, 0.85);
      addFace('Frame_Right', tD, tH, [htW, 0, 0], [0, 90, 0], controller, cFrame, 0.95);
    }
    else if (typeUpper === 'GLASSES') {
      const cFrame = [0.10, 0.10, 0.12, 1.0];
      const cLens = [0.12, 0.14, 0.18, 0.55];
      const cMetal = [0.85, 0.74, 0.42, 1.0];
      const gL = 540;

      addFace('Nose_Bridge_Metal', 64, 14, [0, -6, 0], [0, 0, 0], controller, cMetal, 1.0);
      addFace('Left_Lens_Rim', 260, 180, [-160, 0, 0], [0, 0, 0], controller, cFrame, 1.0, 20);
      addFace('Left_Lens_Glass', 235, 155, [-160, 0, 1], [0, 0, 0], controller, cLens, 1.0, 16, null, 0.6);
      addFace('Right_Lens_Rim', 260, 180, [160, 0, 0], [0, 0, 0], controller, cFrame, 1.0, 20);
      addFace('Right_Lens_Glass', 235, 155, [160, 0, 1], [0, 0, 0], controller, cLens, 1.0, 16, null, 0.6);

      const hLeftTemple = addHinge('Left_Temple_Hinge', [-310, -78, 0], [0, 0, 0]);
      addFace('Left_Temple_Arm', gL, 20, [0, 0, gL / 2], [0, -90, 0], hLeftTemple, cFrame, 0.95);

      const hRightTemple = addHinge('Right_Temple_Hinge', [310, -78, 0], [0, 0, 0]);
      addFace('Right_Temple_Arm', gL, 20, [0, 0, gL / 2], [0, 90, 0], hRightTemple, cFrame, 0.95);
    }
    else if (typeUpper === 'WINDOW') {
      const cFrame = [0.42, 0.28, 0.18, 1.0];
      const cSash = [0.55, 0.38, 0.24, 1.0];
      const cGlass = [0.65, 0.82, 0.92, 0.28];
      const wW = 760, wH = 920;
      const hwW = wW / 2, hwH = wH / 2;
      const sW = wW / 2;

      addFace('Architrave_Top', wW + 60, 30, [0, -hwH - 15, 0], [0, 0, 0], controller, cFrame, 1.05);
      addFace('Architrave_Left', 30, wH + 15, [-hwW - 15, 7.5, 0], [0, 0, 0], controller, cFrame, 0.9);
      addFace('Architrave_Right', 30, wH + 15, [hwW + 15, 7.5, 0], [0, 0, 0], controller, cFrame, 0.95);

      const hLeftPane = addHinge('Left_Pane_Hinge', [-hwW, 0, 0], [0, 0, 0]);
      addFace('Left_Glass', sW - 20, wH - 20, [sW / 2, 0, 0], [0, 0, 0], hLeftPane, cGlass, 1.0, 0, selLayer, 0.7);
      addFace('Left_Front_Rail', sW, 32, [sW / 2, -hwH + 16, -9], [0, 0, 0], hLeftPane, cSash, 1.05);

      const hRightPane = addHinge('Right_Pane_Hinge', [hwW, 0, 0], [0, 0, 0]);
      addFace('Right_Glass', sW - 20, wH - 20, [-sW / 2, 0, 0], [0, 0, 0], hRightPane, cGlass, 1.0, 0, null, 0.7);
      addFace('Right_Front_Rail', sW, 32, [-sW / 2, -hwH + 16, -9], [0, 0, 0], hRightPane, cSash, 1.05);
    }
    else if (typeUpper === 'DOOR') {
      const cDoor = [0.55, 0.38, 0.24, 1.0];
      const cFrame = [0.42, 0.28, 0.18, 1.0];
      const cHandle = [0.86, 0.76, 0.45, 1.0];
      const dW = 560, dH = 1080, dD = 36;
      const hdW = dW / 2, hdH = dH / 2, hdD = dD / 2;

      addFace('Architrave_Top', dW + 60, 30, [0, -hdH - 15, 0], [0, 0, 0], controller, cFrame, 1.05);
      addFace('Architrave_Left', 30, dH, [-hdW - 15, 0, 0], [0, 0, 0], controller, cFrame, 0.9);
      addFace('Architrave_Right', 30, dH, [hdW + 15, 0, 0], [0, 0, 0], controller, cFrame, 0.95);

      const doorHinge = addHinge('Door_Hinge', [-hdW + 4, 0, 0], [0, 0, 0]);
      addFace('Door_Front', dW, dH, [hdW, 0, -hdD], [0, 0, 0], doorHinge, cDoor, 1.05, 0, selLayer);
      addFace('Door_Back', dW, dH, [hdW, 0, hdD], [0, 180, 0], doorHinge, cDoor, 0.85);
      addFace('Door_Handle', 22, 90, [dW - 48, 10, -hdD - 2], [0, 0, 0], doorHinge, cHandle, 1.2);
    }
    else if (typeUpper === 'DESK') {
      const cTop = [0.55, 0.38, 0.24, 1.0];
      const cFrame = [0.20, 0.21, 0.24, 1.0];
      const dW = 1100, dD = 580, dThick = 34, lH = 520;
      const hdW = dW / 2, hdD = dD / 2, hdThick = dThick / 2;

      addFace('Desk_Top_Surface', dW, dD, [0, -hdThick, 0], [-90, 0, 0], controller, cTop, 1.15, 0, selLayer);
      addFace('Desk_Bottom_Surface', dW, dD, [0, hdThick, 0], [90, 0, 0], controller, cTop, 0.6);
      addFace('Desk_Front_Edge', dW, dThick, [0, 0, -hdD], [0, 0, 0], controller, cFrame, 1.0);

      const deskLegCoords = [
        { name: 'Leg_FL', x: -hdW + 70, z: -hdD + 70 },
        { name: 'Leg_BL', x: -hdW + 70, z: hdD - 70 },
        { name: 'Leg_FR', x: hdW - 70, z: -hdD + 70 },
        { name: 'Leg_BR', x: hdW - 70, z: hdD - 70 }
      ];
      for (let dl = 0; dl < deskLegCoords.length; dl++) {
        const dlp = deskLegCoords[dl];
        const legY = hdThick + lH / 2;
        addFace(`${dlp.name}_F`, 50, lH, [dlp.x, legY, dlp.z - 25], [0, 0, 0], controller, cFrame, 1.0);
        addFace(`${dlp.name}_L`, 50, lH, [dlp.x - 25, legY, dlp.z], [0, -90, 0], controller, cFrame, 0.85);
        addFace(`${dlp.name}_R`, 50, lH, [dlp.x + 25, legY, dlp.z], [0, 90, 0], controller, cFrame, 0.95);
      }
    }
    else if (typeUpper === 'MONITOR') {
      const cScreen = [0.02, 0.02, 0.02, 1.0];
      const cStand = [0.78, 0.80, 0.84, 1.0];
      const cChassis = [0.18, 0.20, 0.23, 1.0];

      let mW = 940, mH = 540;
      if (selLayer && selLayer.scaleW && selLayer.scaleW > 100) {
        mW = Math.round(selLayer.scaleW);
        mH = Math.round(selLayer.scaleH && selLayer.scaleH > 50 ? selLayer.scaleH : mW * (540 / 940));
      } else if (selLayer && selLayer.scaleH && selLayer.scaleH > 100) {
        mH = Math.round(selLayer.scaleH);
        mW = Math.round(mH * (940 / 540));
      }
      const mD = Math.max(16, Math.round(mW * 0.02));
      const hmW = mW / 2, hmH = mH / 2, hmD = mD / 2;

      addFace('Front_Bezel', mW, mH, [0, 0, hmD], [0, 0, 0], controller, cScreen, 1.0, 16);
      addFace('Screen_Display', mW - 24, mH - 24, [0, 0, hmD + 1], [0, 0, 0], controller, cScreen, 0.05, 12, selLayer);
      addFace('Back_Cover', mW, mH, [0, 0, -hmD], [0, 180, 0], controller, cChassis, 1.0, 16);
      addFace('Stand_Arm', Math.round(mW * 0.075), Math.round(mH * 0.7), [0, hmH - 60, -hmD - 40], [15, 180, 0], controller, cStand, 1.0);
      addFace('Desktop_Base_Plate', Math.round(mW * 0.36), Math.round(mH * 0.44), [0, hmH + Math.round(mH * 0.2), -hmD - 10], [90, 0, 0], controller, cStand, 1.1, 16);
    }
    else if (typeUpper === 'PC') {
      const cChassis = [0.12, 0.13, 0.15, 1.0];
      const cGlass = [0.18, 0.22, 0.28, 0.45];
      const cRGB = [0.0, 0.85, 1.0, 1.0];
      const pW = 320, pH = 740, pD = 620;
      const hpW = pW / 2, hpH = pH / 2, hpD = pD / 2;

      addFace('Front_Panel', pW, pH, [0, 0, -hpD], [0, 0, 0], controller, cChassis, 1.0, 0, selLayer);
      addFace('Front_RGB_Strip_L', 10, pH - 60, [-hpW + 30, 0, -hpD - 2], [0, 0, 0], controller, cRGB, 1.5);
      addFace('Front_RGB_Strip_R', 10, pH - 60, [hpW - 30, 0, -hpD - 2], [0, 0, 0], controller, cRGB, 1.5);
      addFace('Tempered_Glass_Panel', pD - 20, pH - 20, [-hpW - 1, 0, 0], [0, -90, 0], controller, cGlass, 1.0, 0, null, 0.5);
      addFace('Right_Steel_Panel', pD, pH, [hpW, 0, 0], [0, 90, 0], controller, cChassis, 0.95);
      addFace('Top_Exhaust_Panel', pW, pD, [0, -hpH, 0], [-90, 0, 0], controller, cChassis, 1.1);
      addFace('Bottom_Chassis', pW, pD, [0, hpH, 0], [90, 0, 0], controller, cChassis, 0.65);
      addFace('Back_IO_Panel', pW, pH, [0, 0, hpD], [0, 180, 0], controller, cChassis, 0.75);
    }
    else {
      addFace('Front', 400, 400, [0, 0, -200], [0, 0, 0], controller, [0.7, 0.7, 0.7, 1.0], 1.0, 0, selLayer);
      addFace('Back', 400, 400, [0, 0, 200], [0, 180, 0], controller, [0.5, 0.5, 0.5, 1.0], 1.0);
      addFace('Top', 400, 400, [0, -200, 0], [90, 0, 0], controller, [0.8, 0.8, 0.8, 1.0], 1.0);
      addFace('Bottom', 400, 400, [0, 200, 0], [-90, 0, 0], controller, [0.4, 0.4, 0.4, 1.0], 1.0);
    }

    const objCount = layers.filter(l => l.name && l.name.startsWith(`${baseName}_Comp`)).length + 1;
    const precompName = objCount > 1 ? `${baseName}_Comp ${objCount}` : `${baseName}_Comp`;

    return ctx.scene3d.wrapIn3DPrecomp({
      name: precompName,
      compW,
      compH,
      startSec,
      durationSec,
      childLayers,
      replaceLayer: selLayer,
      pps
    });
  },

  // ============================================================================
  // 2. LOGIKA ALGORITMA MINECRAFT 3D CHARACTER RIG (GEN_3D_MC)
  // ============================================================================
  createProceduralMC(ctx) {
    const layers = ctx.layers.getAll();
    const selLayer = ctx.layers.getActive();
    const { startSec, durationSec, pps } = ctx.scene3d.getTiming(selLayer);
    const [baseW, baseH] = ctx.scene3d.getBaseDims();

    const masterCtrl = ctx.scene3d.create3DNull({
      name: 'MC_Character_Controller',
      pos: [baseW / 2, baseH / 2, 0],
      ori: [0, 0, 0],
      startSec,
      durationSec,
      pps
    });

    const childLayers = [masterCtrl];
    const S = 25;

    const torsoCtrl = ctx.scene3d.create3DNull({ name: 'Torso_Controller', pos: [0, 0, 0], ori: [0, 0, 0], parent: masterCtrl, startSec, durationSec, pps });
    const headHinge = ctx.scene3d.create3DNull({ name: 'Head_Hinge', pos: [0, -6 * S, 0], ori: [0, 0, 0], parent: torsoCtrl, startSec, durationSec, pps });
    const rArmHinge = ctx.scene3d.create3DNull({ name: 'Right_Arm_Hinge', pos: [-6 * S, -5 * S, 0], ori: [0, 0, 0], parent: torsoCtrl, startSec, durationSec, pps });
    const lArmHinge = ctx.scene3d.create3DNull({ name: 'Left_Arm_Hinge', pos: [6 * S, -5 * S, 0], ori: [0, 0, 0], parent: torsoCtrl, startSec, durationSec, pps });
    const rLegHinge = ctx.scene3d.create3DNull({ name: 'Right_Leg_Hinge', pos: [-2 * S, 6 * S, 0], ori: [0, 0, 0], parent: torsoCtrl, startSec, durationSec, pps });
    const lLegHinge = ctx.scene3d.create3DNull({ name: 'Left_Leg_Hinge', pos: [2 * S, 6 * S, 0], ori: [0, 0, 0], parent: torsoCtrl, startSec, durationSec, pps });

    childLayers.push(torsoCtrl, headHinge, rArmHinge, lArmHinge, rLegHinge, lLegHinge);

    function createMCBox(boxName, bw, bh, bd, parent, offsetPos = [0, 0, 0], colorHex = '#3b82f6') {
      const w = bw * S;
      const h = bh * S;
      const d = bd * S;
      const hw = w / 2, hh = h / 2, hd = d / 2;
      const ox = offsetPos[0], oy = offsetPos[1], oz = offsetPos[2];

      const faces = [
        ctx.scene3d.create3DFace({ name: `${boxName}_Front`, w, h, pos: [ox, oy, oz - hd], ori: [0, 0, 0], parent, color: colorHex, startSec, durationSec, pps }),
        ctx.scene3d.create3DFace({ name: `${boxName}_Back`, w, h, pos: [ox, oy, oz + hd], ori: [0, 180, 0], parent, color: colorHex, startSec, durationSec, pps }),
        ctx.scene3d.create3DFace({ name: `${boxName}_Top`, w, d, pos: [ox, oy - hh, oz], ori: [90, 0, 0], parent, color: colorHex, startSec, durationSec, pps }),
        ctx.scene3d.create3DFace({ name: `${boxName}_Bottom`, w, d, pos: [ox, oy + hh, oz], ori: [-90, 0, 0], parent, color: colorHex, startSec, durationSec, pps }),
        ctx.scene3d.create3DFace({ name: `${boxName}_Left`, d, h, pos: [ox + hw, oy, oz], ori: [0, 90, 0], parent, color: colorHex, startSec, durationSec, pps }),
        ctx.scene3d.create3DFace({ name: `${boxName}_Right`, d, h, pos: [ox - hw, oy, oz], ori: [0, -90, 0], parent, color: colorHex, startSec, durationSec, pps })
      ];

      childLayers.push(...faces);
    }

    const cSkin = '#c68661';
    const cShirt = '#00a8a8';
    const cPants = '#2b3984';

    createMCBox('Head', 8, 8, 8, headHinge, [0, -4 * S, 0], cSkin);
    createMCBox('Torso', 8, 12, 4, torsoCtrl, [0, 0, 0], cShirt);
    createMCBox('Right_Arm', 4, 12, 4, rArmHinge, [0, 6 * S, 0], cShirt);
    createMCBox('Left_Arm', 4, 12, 4, lArmHinge, [0, 6 * S, 0], cShirt);
    createMCBox('Right_Leg', 4, 12, 4, rLegHinge, [0, 6 * S, 0], cPants);
    createMCBox('Left_Leg', 4, 12, 4, lLegHinge, [0, 6 * S, 0], cPants);

    const mcCount = layers.filter(l => l.name && l.name.startsWith('MC_Character_Comp')).length + 1;
    const precompName = mcCount > 1 ? `MC_Character_Comp ${mcCount}` : 'MC_Character_Comp';

    return ctx.scene3d.wrapIn3DPrecomp({
      name: precompName,
      compW: baseW,
      compH: baseH,
      startSec,
      durationSec,
      childLayers,
      replaceLayer: selLayer,
      pps
    });
  },

  // ============================================================================
  // 3. LOGIKA ALGORITMA 2-SPLIT, 3-SPLIT, DAN TUNNEL 3D
  // ============================================================================
  createProcedural2Split(ctx) {
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      ctx.toast('Please select a layer to 2-Split');
      return JSON.stringify({ error: true, message: 'Please select a layer to split!' });
    }

    const { startSec, durationSec, pps } = ctx.scene3d.getTiming(selLayer);
    const [baseW, baseH] = ctx.scene3d.getBaseDims();

    const layerW = selLayer.scaleW || selLayer.mediaWidth || 400;
    const layerH = selLayer.scaleH || selLayer.mediaHeight || 400;
    const colW = layerW / 2;

    const masterCtrl = ctx.scene3d.create3DNull({
      name: `${selLayer.name} [2-Split Controller]`,
      pos: [baseW / 2, baseH / 2, 0],
      ori: [0, 0, 0],
      startSec,
      durationSec,
      pps
    });

    const leftCol = ctx.scene3d.create3DFace({
      name: `${selLayer.name} - Left`,
      w: colW,
      h: layerH,
      pos: [-colW / 2, 0, 0],
      ori: [0, 0, 0],
      parent: masterCtrl,
      color: '#708090',
      textureLayer: selLayer,
      startSec,
      durationSec,
      pps
    });

    const rightCol = ctx.scene3d.create3DFace({
      name: `${selLayer.name} - Right`,
      w: colW,
      h: layerH,
      pos: [colW / 2, 0, 0],
      ori: [0, 0, 0],
      parent: masterCtrl,
      color: '#778899',
      textureLayer: selLayer,
      startSec,
      durationSec,
      pps
    });

    return ctx.scene3d.wrapIn3DPrecomp({
      name: `${selLayer.name} [2-Split Comp]`,
      compW: baseW,
      compH: baseH,
      startSec,
      durationSec,
      childLayers: [masterCtrl, leftCol, rightCol],
      replaceLayer: selLayer,
      pps
    });
  },

  createProcedural3Split(ctx) {
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      ctx.toast('Please select a layer to 3-Split');
      return JSON.stringify({ error: true, message: 'Please select a layer to split!' });
    }

    const { startSec, durationSec, pps } = ctx.scene3d.getTiming(selLayer);
    const [baseW, baseH] = ctx.scene3d.getBaseDims();

    const layerW = selLayer.scaleW || selLayer.mediaWidth || 600;
    const layerH = selLayer.scaleH || selLayer.mediaHeight || 400;
    const colW = layerW / 3;

    const masterCtrl = ctx.scene3d.create3DNull({
      name: `${selLayer.name} [3-Split Controller]`,
      pos: [baseW / 2, baseH / 2, 0],
      ori: [0, 0, 0],
      startSec,
      durationSec,
      pps
    });

    const leftCol = ctx.scene3d.create3DFace({
      name: `${selLayer.name} - Left`,
      w: colW,
      h: layerH,
      pos: [-colW, 0, 0],
      ori: [0, 0, 0],
      parent: masterCtrl,
      color: '#708090',
      textureLayer: selLayer,
      startSec,
      durationSec,
      pps
    });

    const centerCol = ctx.scene3d.create3DFace({
      name: `${selLayer.name} - Center`,
      w: colW,
      h: layerH,
      pos: [0, 0, 0],
      ori: [0, 0, 0],
      parent: masterCtrl,
      color: '#778899',
      textureLayer: selLayer,
      startSec,
      durationSec,
      pps
    });

    const rightCol = ctx.scene3d.create3DFace({
      name: `${selLayer.name} - Right`,
      w: colW,
      h: layerH,
      pos: [colW, 0, 0],
      ori: [0, 0, 0],
      parent: masterCtrl,
      color: '#808080',
      textureLayer: selLayer,
      startSec,
      durationSec,
      pps
    });

    return ctx.scene3d.wrapIn3DPrecomp({
      name: `${selLayer.name} [3-Split Comp]`,
      compW: baseW,
      compH: baseH,
      startSec,
      durationSec,
      childLayers: [masterCtrl, leftCol, centerCol, rightCol],
      replaceLayer: selLayer,
      pps
    });
  },

  createProceduralTunnel(ctx) {
    const selLayer = ctx.layers.getActive();
    if (!selLayer) {
      ctx.toast('Please select a layer to generate Tunnel');
      return JSON.stringify({ error: true, message: 'Please select a layer for 3D Tunnel!' });
    }

    const { startSec, durationSec, pps } = ctx.scene3d.getTiming(selLayer);
    const [baseW, baseH] = ctx.scene3d.getBaseDims();

    const layerW = selLayer.scaleW || selLayer.mediaWidth || 500;
    const layerH = selLayer.scaleH || selLayer.mediaHeight || 500;

    const masterCtrl = ctx.scene3d.create3DNull({
      name: 'Tunnel_Controller',
      pos: [baseW / 2, baseH / 2, 0],
      ori: [0, 0, 0],
      startSec,
      durationSec,
      pps
    });

    const rings = [];
    const ringCount = 10;
    const spacing = 350;
    const twistAngle = 15;

    for (let k = 0; k < ringCount; k++) {
      rings.push(ctx.scene3d.create3DFace({
        name: `Tunnel_Ring_${k + 1}`,
        w: layerW,
        h: layerH,
        pos: [0, 0, -k * spacing],
        ori: [0, 0, k * twistAngle],
        parent: masterCtrl,
        color: '#607d8b',
        textureLayer: selLayer,
        startSec,
        durationSec,
        pps
      }));
    }

    return ctx.scene3d.wrapIn3DPrecomp({
      name: 'Tunnel_Comp',
      compW: baseW,
      compH: baseH,
      startSec,
      durationSec,
      childLayers: [masterCtrl, ...rings],
      replaceLayer: selLayer,
      pps
    });
  },

  tools: {
    GEN_3D_2SPLIT(ctx) { return this.createProcedural2Split(ctx); },
    GEN_3D_3SPLIT(ctx) { return this.createProcedural3Split(ctx); },
    GEN_3D_TUNNEL(ctx) { return this.createProceduralTunnel(ctx); },
    GEN_3D_MC(ctx) { return this.createProceduralMC(ctx); },
    GEN_3D_BOX(ctx) { return this.createProcedural3D(ctx, 'BOX'); },
    GEN_3D_CABINET(ctx) { return this.createProcedural3D(ctx, 'CABINET'); },
    GEN_3D_TABLE(ctx) { return this.createProcedural3D(ctx, 'TABLE'); },
    GEN_3D_PHONE(ctx) { return this.createProcedural3D(ctx, 'PHONE'); },
    GEN_3D_LAPTOP(ctx) { return this.createProcedural3D(ctx, 'LAPTOP'); },
    GEN_3D_ROOM(ctx) { return this.createProcedural3D(ctx, 'ROOM'); },
    GEN_3D_CRT(ctx) { return this.createProcedural3D(ctx, 'CRT'); },
    GEN_3D_ZFLIP(ctx) { return this.createProcedural3D(ctx, 'ZFLIP'); },
    GEN_3D_ZFOLD(ctx) { return this.createProcedural3D(ctx, 'ZFOLD'); },
    GEN_3D_BOOK(ctx) { return this.createProcedural3D(ctx, 'BOOK'); },
    GEN_3D_BINDER(ctx) { return this.createProcedural3D(ctx, 'BINDER'); },
    GEN_3D_TABLET(ctx) { return this.createProcedural3D(ctx, 'TABLET'); },
    GEN_3D_GLASSES(ctx) { return this.createProcedural3D(ctx, 'GLASSES'); },
    GEN_3D_WINDOW(ctx) { return this.createProcedural3D(ctx, 'WINDOW'); },
    GEN_3D_DOOR(ctx) { return this.createProcedural3D(ctx, 'DOOR'); },
    GEN_3D_DESK(ctx) { return this.createProcedural3D(ctx, 'DESK'); },
    GEN_3D_MONITOR(ctx) { return this.createProcedural3D(ctx, 'MONITOR'); },
    GEN_3D_PC(ctx) { return this.createProcedural3D(ctx, 'PC'); }
  },

  // ============================================================================
  // 4. TAMPILAN UI EXTENSION CARD
  // ============================================================================
  build(ui, ctx) {
    const self = this;

    ui.section('Basic 3D');
    ui.grid({ cols: 3 }, [
      ui.button({ label: '3 SPLIT', icon: 'view_column', title: '3D 3-Split Columns', onClick() { self.createProcedural3Split(ctx); } }),
      ui.button({ label: '2 SPLIT', icon: 'view_stream', title: '3D 2-Split Screens', onClick() { self.createProcedural2Split(ctx); } }),
      ui.button({ label: 'TUNNEL', icon: 'filter_tilt_shift', title: '3D Depth Tunnel', onClick() { self.createProceduralTunnel(ctx); } })
    ]);

    ui.section('Devices & Tech');
    ui.grid({ cols: 4 }, [
      ui.button({ label: 'PHONE', icon: 'smartphone', title: '3D Smartphone Mockup', onClick() { self.createProcedural3D(ctx, 'PHONE'); } }),
      ui.button({ label: 'Z FLIP', icon: 'mobile_friendly', title: '3D Flip Phone Fold', onClick() { self.createProcedural3D(ctx, 'ZFLIP'); } }),
      ui.button({ label: 'Z FOLD', icon: 'menu_book', title: '3D Foldable Tablet/Phone', onClick() { self.createProcedural3D(ctx, 'ZFOLD'); } }),
      ui.button({ label: 'TABLET', icon: 'tablet_mac', title: '3D Tablet Frame', onClick() { self.createProcedural3D(ctx, 'TABLET'); } }),
      ui.button({ label: 'LAPTOP', icon: 'laptop_mac', title: '3D Laptop with Screen', onClick() { self.createProcedural3D(ctx, 'LAPTOP'); } }),
      ui.button({ label: 'MONITOR', icon: 'desktop_windows', title: '3D Desktop Monitor', onClick() { self.createProcedural3D(ctx, 'MONITOR'); } }),
      ui.button({ label: 'PC TOWER', icon: 'computer', title: '3D PC Computer Case', onClick() { self.createProcedural3D(ctx, 'PC'); } }),
      ui.button({ label: 'CRT TV', icon: 'tv', title: '3D Retro CRT Television', onClick() { self.createProcedural3D(ctx, 'CRT'); } })
    ]);

    ui.section('Room & Furniture');
    ui.grid({ cols: 3 }, [
      ui.button({ label: 'ROOM', icon: 'roofing', title: '3D Isometric Room Box', onClick() { self.createProcedural3D(ctx, 'ROOM'); } }),
      ui.button({ label: 'DOOR', icon: 'door_front', title: '3D Hinged Door', onClick() { self.createProcedural3D(ctx, 'DOOR'); } }),
      ui.button({ label: 'WINDOW', icon: 'window', title: '3D Window Pane', onClick() { self.createProcedural3D(ctx, 'WINDOW'); } }),
      ui.button({ label: 'TABLE', icon: 'table_restaurant', title: '3D Table Surface', onClick() { self.createProcedural3D(ctx, 'TABLE'); } }),
      ui.button({ label: 'DESK', icon: 'desk', title: '3D Office Desk', onClick() { self.createProcedural3D(ctx, 'DESK'); } }),
      ui.button({ label: 'CABINET', icon: 'inventory_2', title: '3D Storage Cabinet', onClick() { self.createProcedural3D(ctx, 'CABINET'); } })
    ]);

    ui.section('Props & Character');
    ui.grid({ cols: 5 }, [
      ui.button({ label: 'BOX', icon: 'view_in_ar', title: '3D Parcel Box', onClick() { self.createProcedural3D(ctx, 'BOX'); } }),
      ui.button({ label: 'BOOK', icon: 'auto_stories', title: '3D Book Cover & Pages', onClick() { self.createProcedural3D(ctx, 'BOOK'); } }),
      ui.button({ label: 'BINDER', icon: 'folder_special', title: '3D Office Binder', onClick() { self.createProcedural3D(ctx, 'BINDER'); } }),
      ui.button({ label: 'GLASSES', icon: 'visibility', title: '3D Glasses Frame', onClick() { self.createProcedural3D(ctx, 'GLASSES'); } }),
      ui.button({ label: 'MC 3D', icon: 'accessibility_new', title: '3D Minecraft Character Rig', onClick() { self.createProcedural3D ? self.createProceduralMC(ctx) : null; } })
    ]);
  }
});
