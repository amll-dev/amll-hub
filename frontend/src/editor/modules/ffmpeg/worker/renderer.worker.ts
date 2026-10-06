let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
let canvasWidth = 0;
let canvasHeight = 0;
let dpr = 1;

let peaksCapacity = 16384 * 3;
let peaksBuffer = new Float32Array(peaksCapacity);
let peaksCount = 0;
let primaryColor = '#00ffa21e';

let analyzerPort: MessagePort | null = null;

function drawWaveform() {
  if (!offscreenCtx || canvasWidth === 0 || canvasHeight === 0 || peaksCount === 0) return;

  offscreenCtx.clearRect(0, 0, canvasWidth, canvasHeight);

  offscreenCtx.fillStyle = primaryColor;
  offscreenCtx.beginPath();

  const halfH = canvasHeight / 2;
  const tripletCount = Math.floor(peaksCount / 3);
  const AMPLITUDE_SCALE = 0.6;

  for (let i = 0; i < tripletCount; i++) {
    const progress = peaksBuffer[i * 3];
    const maxVal = peaksBuffer[i * 3 + 2];

    const x = progress * canvasWidth;
    const yMax = halfH - maxVal * halfH * AMPLITUDE_SCALE;

    if (i === 0) offscreenCtx.moveTo(x, yMax);
    else offscreenCtx.lineTo(x, yMax);
  }

  for (let i = tripletCount - 1; i >= 0; i--) {
    const progress = peaksBuffer[i * 3];
    const minVal = peaksBuffer[i * 3 + 1];

    const x = progress * canvasWidth;
    const yMin = halfH - minVal * halfH * AMPLITUDE_SCALE;

    offscreenCtx.lineTo(x, yMin);
  }
  offscreenCtx.closePath();
  offscreenCtx.fill();
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT_CANVAS') {
    const { canvas, width, height, dpr: deviceDpr, color } = payload;
    canvasWidth = width;
    canvasHeight = height;
    dpr = deviceDpr;
    if (color) primaryColor = color;

    if (canvas) {
      offscreenCtx = (canvas as OffscreenCanvas).getContext('2d', {
        alpha: true,
        desynchronized: true,
      });
    }

    if (offscreenCtx) {
      offscreenCtx.canvas.width = canvasWidth * dpr;
      offscreenCtx.canvas.height = canvasHeight * dpr;
      offscreenCtx.scale(dpr, dpr);
    }
  } else if (type === 'RESIZE') {
    canvasWidth = payload.width;
    canvasHeight = payload.height;
    dpr = payload.dpr;
    if (payload.color) primaryColor = payload.color;

    if (offscreenCtx && canvasWidth > 0 && canvasHeight > 0) {
      offscreenCtx.canvas.width = canvasWidth * dpr;
      offscreenCtx.canvas.height = canvasHeight * dpr;
      offscreenCtx.scale(dpr, dpr);
      drawWaveform();
    }
  } else if (type === 'CLEAR') {
    peaksCount = 0;
    peaksCapacity = 16384 * 3;
    peaksBuffer = new Float32Array(peaksCapacity);

    if (offscreenCtx) {
      offscreenCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    }
  } else if (type === 'NEW_PORT') {
    if (analyzerPort) {
      analyzerPort.onmessage = null;
      analyzerPort.close();
    }
    analyzerPort = payload.port;
    if (!analyzerPort) return;

    analyzerPort.onmessage = (msg) => {
      const pType = msg.data.type;
      const pPayload = msg.data.payload;

      if (pType === 'PEAKS_UPDATE') {
        const { buffer, count } = pPayload;
        const chunk = new Float32Array(buffer, 0, count);

        while (peaksCount + count > peaksCapacity) {
          peaksCapacity *= 2;
          const newBuffer = new Float32Array(peaksCapacity);
          newBuffer.set(peaksBuffer);
          peaksBuffer = newBuffer;
        }

        peaksBuffer.set(chunk, peaksCount);
        peaksCount += count;

        drawWaveform();

        analyzerPort?.postMessage({ type: 'BUFFER_RETURN', payload: buffer }, [buffer]);
      } else if (pType === 'PEAKS_FINALIZE') {
        if (peaksCount >= 3) {
          const maxProgress = peaksBuffer[peaksCount - 3];
          if (maxProgress > 0 && maxProgress < 1.0) {
            const tripletCount = Math.floor(peaksCount / 3);
            for (let i = 0; i < tripletCount; i++) {
              peaksBuffer[i * 3] /= maxProgress;
            }
          }
        }
        drawWaveform();
      }
    };
  }
};
