import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { checkScoreXML } from './score-import';

const ready = createVerovioModule().then((module: any) => new VerovioToolkit(module));
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const toolkit = await ready;
      const { mode, width, zoom } = data;
      toolkit.setOptions({
        scale: 40,
        breaks: mode === 'horizontal' ? 'none' : 'auto',
        pageWidth: Math.max(340, width) / (0.4 * zoom),
        pageHeight: 3000,
        adjustPageHeight: true,
        svgViewBox: true,
        xmlIdChecksum: true,
        header: 'none',
        footer: 'none',
        pageMarginTop: 35,
        pageMarginBottom: 35,
        pageMarginLeft: 35,
        pageMarginRight: 35,
        lyricSize: 4.8,
      });

      let musical;
      if (data.type === 'load') {
        checkScoreXML(data.xml);
        if (!toolkit.loadData(data.xml)) throw new Error('Cette partition ne peut pas être lue. Essayez un fichier MusicXML ou MXL.');
        const timemap = toolkit.renderToTimemap({ includeMeasures: true, includeRests: true });
        const notes: Record<string, { pitch: number; time: number; duration: number; writtenId: string }> = {};
        for (const event of timemap) {
          for (const id of event.on || []) {
            if (!notes[id]) {
              notes[id] = { ...toolkit.getMIDIValuesForElement(id), writtenId: toolkit.getNotatedIdForElement(id) || id };
            }
          }
        }
        musical = { timemap, notes, midi: toolkit.renderToMIDI(), mei: toolkit.getMEI({}) };
      } else {
        toolkit.redoLayout();
      }

      const pages: string[] = [];
      for (let page = 1; page <= toolkit.getPageCount(); page++) pages.push(toolkit.renderToSVG(page));
      self.postMessage({ id: data.id, pages, musical });
    } catch (error) {
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
