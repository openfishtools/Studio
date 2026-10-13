/**
 * OpenFishTools Extension - Cube Generator Card
 * Provides: 3D cube folding based on custom dimensions or active layer size.
 */
Card({
  id: 'cube_generator',
  name: 'Cube Generator',
  icon: 'view_in_ar',
  description: 'Generator kubus 3D berdasarkan dimensi Width, Height, Depth, atau ukuran layer terpilih.',
  category: '3D',
  defaultEnabled: true,

  build(ui, ctx) {
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
        ctx.runTool('CREATE_CUBE', {
          width: widthVal,
          height: heightVal,
          depth: depthVal,
          useLayer: useLayerDimensions
        });
      }
    });
  }
});
