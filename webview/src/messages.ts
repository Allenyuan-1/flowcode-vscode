import type { CellInfo, FileGraph } from '../../src/core/types';
import type { StudioDraft } from '../../src/core/studio';

export interface NotebookInfo {
  mode: 'all' | 'cell';
  activeCell: number;
  count: number;
  cells: CellInfo[];
}

export type HostToWebview =
  | {
      type: 'graph';
      graph: import('../../src/core/types').FlowGraph;
      methods: import('../../src/core/types').MethodSpec[];
      pythonVersion?: string;
      fileName: string;
      filePath: string;
      documentUri: string;
      dirty: boolean;
      notebook?: NotebookInfo;
    }
  | { type: 'error'; message: string; kind?: string }
  | { type: 'parseStart' }
  | { type: 'parseEnd' }
  | { type: 'toast'; kind: 'info' | 'warn' | 'error'; message: string }
  | { type: 'applied' }
  | { type: 'cursor'; line: number }
  | { type: 'imported'; data: string }
  | { type: 'fileGraph'; graph: FileGraph; root: string }
  | { type: 'studioKeyStatus'; hasKey: boolean }
  | { type: 'studioResult'; draft: StudioDraft; source: 'ai' | 'local'; error?: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh'; entry?: string; cell?: number }
  | { type: 'apply'; code: string }
  | { type: 'reveal'; line: number; character?: number }
  | { type: 'dirty'; dirty: boolean }
  | { type: 'copy'; text: string }
  | { type: 'toast'; message: string; kind?: 'info' | 'warn' | 'error' }
  | { type: 'export'; json: string }
  | { type: 'import' }
  | { type: 'openSettings' }
  | { type: 'openFile' }
  | { type: 'scanFiles' }
  | { type: 'studioKeyStatus' }
  | { type: 'studioSaveKey'; key: string }
  | { type: 'studioGenerate'; requirements: string; code?: string; apiKey?: string };
