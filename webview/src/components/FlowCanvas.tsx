import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlowGraph, Endpoint, Point, PortType } from '../../../src/core/types';
import {
  NODE_HEADER, NODE_ROW, NODE_WIDTH, VALUE_GAP, VALUE_WIDTH, VALUE_HEIGHT, cloneMethodNode, connect,
  connectionError, createValueNode, graphBounds, nodeHeight, portPosition, pruneValues, uid,
} from '../../../src/core/graph';
import type { FlowOrientation } from '../../../src/core/layout';
import { clamp, uniqueName } from '../utils';
import { computeFocus } from '../focus';
import { EmptyState } from './EmptyState';
import { Edges, edgeGeometry } from './Edges';
import { MethodNodeView, ValueNodeView } from './NodeViews';
import { Fit, Link2 } from '../icons';
import type { Selection, Viewport } from '../store';

export interface CanvasApi {
  center: () => Point;
  reflow: () => void;
}

function orientationFor(width: number, height: number): FlowOrientation {
  return width >= height * 1.04 ? 'horizontal' : 'vertical';
}

interface DragState {
  kind: 'method' | 'value';
  id: string;
  start: Point;
  origin: Point;
  snapshot: FlowGraph;
  moved: boolean;
  duplicated?: boolean;
}

interface PanState {
  startClient: Point;
  origin: Viewport;
}

interface LinkState {
  anchor: Endpoint;
  anchorKind: 'out' | 'in';
  start: Point;
  current: Point;
  type: PortType;
}

/** A port press is a click (focus) until the pointer actually moves. */
interface PendingLink {
  anchor: Endpoint;
  anchorKind: 'out' | 'in';
  start: Point;
  type: PortType;
  client: Point;
  focusNode: string;
  focusPort: string;
}

const LINK_DRAG_THRESHOLD = 4;
/** Screen-space slack around a port when the pointer is not over any card. */
const DROP_SLACK_PX = 84;

interface Props {
  graph: FlowGraph;
  selected: Selection;
  viewport: Viewport;
  fitSignal: number;
  layoutSignal: number;
  orientation: FlowOrientation;
  syncing: boolean;
  apiRef: React.MutableRefObject<CanvasApi | null>;
  onViewport: (viewport: Viewport) => void;
  onReflow: (width: number, height: number, orientation: FlowOrientation) => void;
  onSelect: (selection: Selection) => void;
  onMutate: (mutate: (graph: FlowGraph) => void, options?: { history?: boolean; historyKey?: string }) => void;
  onPushHistory: (snapshot: FlowGraph) => void;
  onReveal: (line: number, character?: number) => void;
  onDeleteNode: (id: string) => void;
  onDeleteValue: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onAddMethod: (methodId: string, point: Point) => void;
  onEditParam: (nodeId: string, side: 'in' | 'out', index: number, anchor: { x: number; y: number }) => void;
  onError: (message: string) => void;
  onAddSample: () => void;
  onRefresh: () => void;
}

export function FlowCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [link, setLink] = useState<LinkState | null>(null);
  const [armed, setArmed] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ node: string; port: string } | null>(null);

  const viewportRef = useRef(props.viewport);
  viewportRef.current = props.viewport;
  const graphRef = useRef(props.graph);
  graphRef.current = props.graph;
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const linkRef = useRef<LinkState | null>(null);
  linkRef.current = link;
  const pendingRef = useRef<PendingLink | null>(null);
  const linkTargetRef = useRef<{ node: string; port: string } | null>(null);

  const applyTarget = (next: { node: string; port: string } | null) => {
    const current = linkTargetRef.current;
    if (current === next || (current && next && current.node === next.node && current.port === next.port)) return;
    linkTargetRef.current = next;
    setLinkTarget(next);
  };

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    const rect = element.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  const toGraph = useCallback((clientX: number, clientY: number): Point => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const view = viewportRef.current;
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.x) / view.zoom,
      y: (clientY - rect.top - view.y) / view.zoom,
    };
  }, []);

  const cardAt = useCallback(
    (clientX: number, clientY: number) => {
      const point = toGraph(clientX, clientY);
      return graphRef.current.nodes.find(
        (node) =>
          point.x >= node.position.x &&
          point.x <= node.position.x + NODE_WIDTH &&
          point.y >= node.position.y &&
          point.y <= node.position.y + nodeHeight(node),
      );
    },
    [toGraph],
  );

  /**
   * Which port does this drop point mean? Anywhere on a card resolves to that
   * card's nearest port on the wanted side; outside cards a generous slack
   * radius around each port still works. Returns null when the drop is not
   * clearly attributable to a port.
   */
  const resolveDrop = useCallback(
    (clientX: number, clientY: number, want: 'in' | 'out'): Endpoint | null => {
      const graph = graphRef.current;
      const point = toGraph(clientX, clientY);
      const slack = DROP_SLACK_PX / Math.max(0.2, viewportRef.current.zoom);
      const distance = (nodeId: string, portId: string) => {
        const pos = portPosition(graph, { node: nodeId, port: portId });
        return Math.hypot(pos.x - point.x, pos.y - point.y);
      };

      const card = graph.nodes.find(
        (node) =>
          point.x >= node.position.x &&
          point.x <= node.position.x + NODE_WIDTH &&
          point.y >= node.position.y &&
          point.y <= node.position.y + nodeHeight(node),
      );
      if (card) {
        let best: { port: string; dist: number } | null = null;
        for (const port of want === 'in' ? card.inputs : card.outputs) {
          const dist = distance(card.id, port.id);
          if (!best || dist < best.dist) best = { port: port.id, dist };
        }
        return best ? { node: card.id, port: best.port } : null;
      }

      const pill = graph.values.find(
        (value) =>
          point.x >= value.position.x &&
          point.x <= value.position.x + VALUE_WIDTH &&
          point.y >= value.position.y &&
          point.y <= value.position.y + VALUE_HEIGHT,
      );
      if (pill && want === 'out' && pill.kind !== 'output') {
        return { node: pill.id, port: `${pill.id}:out` };
      }

      const candidates: { node: string; port: string; dist: number }[] = [];
      const consider = (nodeId: string, portId: string) => {
        const dist = distance(nodeId, portId);
        if (dist <= slack) candidates.push({ node: nodeId, port: portId, dist });
      };
      for (const node of graph.nodes) {
        for (const port of want === 'in' ? node.inputs : node.outputs) consider(node.id, port.id);
      }
      if (want === 'out') {
        for (const value of graph.values) {
          if (value.kind !== 'output') consider(value.id, `${value.id}:out`);
        }
      }
      if (!candidates.length) return null;
      candidates.sort((a, b) => a.dist - b.dist);
      return { node: candidates[0].node, port: candidates[0].port };
    },
    [toGraph],
  );

  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const bounds = graphBounds(graphRef.current);
    if (!bounds.width || !bounds.height) {
      props.onViewport({ x: 80, y: 80, zoom: 1 });
      return;
    }
    const padding = 44;
    const zoom = clamp(
      Math.min((size.width - padding * 2) / bounds.width, (size.height - padding * 2) / bounds.height),
      0.35,
      1.2,
    );
    props.onViewport({
      x: (size.width - bounds.width * zoom) / 2 - bounds.x * zoom,
      y: (size.height - bounds.height * zoom) / 2 - bounds.y * zoom,
      zoom,
    });
  }, [size.width, size.height, props.onViewport]);

  const lastFitSignal = useRef(-1);
  const previousSize = useRef({ width: 0, height: 0 });
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const previous = previousSize.current;
    const shrank = previous.width > 0 && (size.width < previous.width - 2 || size.height < previous.height - 2);
    if (lastFitSignal.current !== props.fitSignal) {
      lastFitSignal.current = props.fitSignal;
      fit();
    } else if (shrank) {
      fit();
    }
    previousSize.current = size;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitSignal, size.width, size.height]);

  const apiRef = props.apiRef;
  const reflow = useCallback(() => {
    if (!size.width || !size.height) return;
    props.onReflow(size.width, size.height, orientationFor(size.width, size.height));
  }, [size.width, size.height, props.onReflow]);

  const lastLayoutSignal = useRef(-1);
  useEffect(() => {
    if (!size.width || !size.height) return;
    if (lastLayoutSignal.current === props.layoutSignal) return;
    lastLayoutSignal.current = props.layoutSignal;
    if (dragRef.current || linkRef.current) return;
    reflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layoutSignal, size.width, size.height]);

  const reflowSize = useRef({ width: 0, height: 0 });
  const reflowOrientation = useRef<FlowOrientation>('horizontal');
  const resizeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!size.width || !size.height) return;
    const previous = reflowSize.current;
    const first = previous.width === 0;
    reflowSize.current = size;
    const orientation = orientationFor(size.width, size.height);
    if (first) {
      reflowOrientation.current = orientation;
      return;
    }
    const orientationChanged = orientation !== reflowOrientation.current;
    reflowOrientation.current = orientation;
    if (!orientationChanged && Math.abs(size.width - previous.width) < 18 && Math.abs(size.height - previous.height) < 18) {
      return;
    }
    if (dragRef.current || linkRef.current) return;
    window.clearTimeout(resizeTimer.current);
    resizeTimer.current = window.setTimeout(
      () => {
        if (!dragRef.current && !linkRef.current) reflow();
      },
      orientationChanged ? 0 : 140,
    );
    return () => window.clearTimeout(resizeTimer.current);
  }, [size.width, size.height, reflow]);

  useEffect(() => {
    apiRef.current = {
      center: () => {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return toGraph(rect.left + rect.width / 2, rect.top + rect.height / 2);
      },
      reflow: () => {
        if (!size.width || !size.height) return;
        props.onReflow(size.width, size.height, orientationFor(size.width, size.height));
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, toGraph, size.width, size.height, props.onReflow]);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const view = viewportRef.current;
      const next = clamp(view.zoom * factor, 0.25, 2.5);
      const gx = (clientX - rect.left - view.x) / view.zoom;
      const gy = (clientY - rect.top - view.y) / view.zoom;
      props.onViewport({
        x: clientX - rect.left - gx * next,
        y: clientY - rect.top - gy * next,
        zoom: next,
      });
    },
    [props.onViewport],
  );

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const handler = (event: WheelEvent) => {
      // The wheel belongs to zoom; panning is done by dragging the canvas.
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const delta = event.deltaY * unit;
      if (!delta) return;
      zoomAt(event.clientX, event.clientY, Math.exp(-delta * 0.0016));
    };
    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, [zoomAt, props.onViewport]);

  const zoomCenter = (factor: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dragRef.current = null;
      panRef.current = null;
      linkRef.current = null;
      pendingRef.current = null;
      setLink(null);
      setPanning(false);
      setArmed(false);
      linkTargetRef.current = null;
      setLinkTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const beginLink = (portElement: HTMLElement, event: React.PointerEvent) => {
    const nodeId = portElement.dataset.portNode!;
    const portId = portElement.dataset.portId!;
    const kind = portElement.dataset.portKind as 'in' | 'out';
    const type = (portElement.dataset.portType ?? 'any') as PortType;
    const graph = graphRef.current;
    const anchor: Endpoint = { node: nodeId, port: portId };
    let start: Endpoint = anchor;
    let anchorKind: 'in' | 'out' = kind;
    if (kind === 'in') {
      const existing = graph.edges.find((edge) => edge.to.node === nodeId && edge.to.port === portId);
      if (existing) {
        start = existing.from;
        anchorKind = 'out';
      }
    }
    pendingRef.current = {
      anchor: start,
      anchorKind,
      start: portPosition(graph, start),
      type,
      client: { x: event.clientX, y: event.clientY },
      focusNode: nodeId,
      focusPort: portId,
    };
    setArmed(true);
    wrapRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const finishLink = (event: React.PointerEvent) => {
    const current = linkRef.current;
    if (!current) return;
    const graph = graphRef.current;
    const point = toGraph(event.clientX, event.clientY);
    const resolved = linkTargetRef.current;
    let completed = false;

    const commitConnection = (from: Endpoint, to: Endpoint): boolean => {
      const error = connectionError(graph, from, to);
      if (error) {
        props.onError(error);
        return false;
      }
      props.onMutate((draft) => {
        connect(draft, from, to);
        pruneValues(draft);
      });
      return true;
    };

    if (resolved) {
      const target: Endpoint = { node: resolved.node, port: resolved.port };
      completed =
        current.anchorKind === 'out' ? commitConnection(current.anchor, target) : commitConnection(target, current.anchor);
    } else if (cardAt(event.clientX, event.clientY)) {
      // Dropped on a card, but that card has no port on the wanted side.
      props.onError(current.anchorKind === 'out' ? '这个模块没有可连接的输入端口' : '这个模块没有可连接的输出端口');
    } else if (current.anchorKind === 'out') {
      const sourceNode = graph.nodes.find((n) => n.id === current.anchor.node);
      const sourcePort = sourceNode?.outputs.find((p) => p.id === current.anchor.port);
      if (sourceNode && sourcePort) {
        const name = uniqueName(graph, sourcePort.name || 'result');
        const value = createValueNode({
          kind: 'output',
          name,
          type: sourcePort.type,
          annotation: sourcePort.annotation,
          position: { x: point.x - VALUE_WIDTH / 2, y: point.y - VALUE_HEIGHT / 2 },
          id: uid('v'),
        });
        props.onMutate((draft) => {
          draft.values.push(value);
          connect(draft, current.anchor, { node: value.id, port: `${value.id}:in` });
        });
        props.onSelect({ kind: 'value', id: value.id });
        completed = true;
      } else {
        props.onError('把线拖到某个模块上松手就能连接；只有方法的输出端口拖到空白处才会生成流程输出');
      }
    } else {
      const name = uniqueName(graph, 'input');
      const value = createValueNode({
        kind: 'input',
        name,
        type: current.type,
        position: { x: point.x - VALUE_WIDTH / 2, y: point.y - VALUE_HEIGHT / 2 },
        id: uid('v'),
      });
      props.onMutate((draft) => {
        draft.values.push(value);
        connect(draft, { node: value.id, port: `${value.id}:out` }, current.anchor);
      });
      props.onSelect({ kind: 'value', id: value.id });
      completed = true;
    }

    if (completed) {
      setHoverEdge(null);
    }
    linkRef.current = null;
    setLink(null);
    applyTarget(null);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    const portElement = target.closest('[data-port-node]') as HTMLElement | null;
    if (portElement) {
      beginLink(portElement, event);
      return;
    }
    if (target.closest('button') || target.closest('input') || target.closest('textarea') || target.closest('select')) {
      return;
    }
    const nodeElement = target.closest('[data-node-id]') as HTMLElement | null;
    if (nodeElement) {
      const id = nodeElement.dataset.nodeId!;
      const kind = nodeElement.dataset.nodeKind as 'method' | 'value';
      const graph = graphRef.current;
      const node = kind === 'method' ? graph.nodes.find((n) => n.id === id) : graph.values.find((n) => n.id === id);
      if (!node) return;
      if (event.altKey && kind === 'method') {
        const clone = cloneMethodNode(node as (typeof graph.nodes)[number], uid('n'));
        props.onMutate(
          (draft) => {
            draft.nodes.push(clone);
          },
          { historyKey: `duplicate-${clone.id}` },
        );
        dragRef.current = {
          kind: 'method',
          id: clone.id,
          start: toGraph(event.clientX, event.clientY),
          origin: { ...clone.position },
          snapshot: structuredClone(graph),
          moved: false,
          duplicated: true,
        };
        props.onSelect({ kind: 'node', id: clone.id });
        wrapRef.current?.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      dragRef.current = {
        kind,
        id,
        start: toGraph(event.clientX, event.clientY),
        origin: { ...node.position },
        snapshot: structuredClone(graph),
        moved: false,
      };
      props.onSelect(kind === 'method' ? { kind: 'node', id } : { kind: 'value', id });
      wrapRef.current?.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    // Empty canvas: pan and clear selection.
    props.onSelect(null);
    panRef.current = {
      startClient: { x: event.clientX, y: event.clientY },
      origin: { ...viewportRef.current },
    };
    setPanning(true);
    wrapRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragRef.current) {
      const drag = dragRef.current;
      const current = toGraph(event.clientX, event.clientY);
      const dx = current.x - drag.start.x;
      const dy = current.y - drag.start.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) drag.moved = true;
      if (!drag.moved) return;
      const next = {
        x: Math.round((drag.origin.x + dx) * 2) / 2,
        y: Math.round((drag.origin.y + dy) * 2) / 2,
      };
      props.onMutate(
        (graph) => {
          const node = drag.kind === 'method' ? graph.nodes.find((n) => n.id === drag.id) : graph.values.find((n) => n.id === drag.id);
          if (node) node.position = next;
        },
        { history: false },
      );
      if (drag.kind === 'value') {
        applyTarget(resolveDrop(event.clientX, event.clientY, 'in'));
      }
      return;
    }
    if (panRef.current) {
      const deltaX = event.clientX - panRef.current.startClient.x;
      const deltaY = event.clientY - panRef.current.startClient.y;
      props.onViewport({
        x: panRef.current.origin.x + deltaX,
        y: panRef.current.origin.y + deltaY,
        zoom: panRef.current.origin.zoom,
      });
      return;
    }
    if (pendingRef.current) {
      const pending = pendingRef.current;
      const dx = event.clientX - pending.client.x;
      const dy = event.clientY - pending.client.y;
      if (Math.hypot(dx, dy) < LINK_DRAG_THRESHOLD) return;
      pendingRef.current = null;
      setArmed(false);
      const next = { ...pending, current: toGraph(event.clientX, event.clientY) };
      linkRef.current = next;
      setLink(next);
      applyTarget(resolveDrop(event.clientX, event.clientY, next.anchorKind === 'out' ? 'in' : 'out'));
      return;
    }
    if (linkRef.current) {
      const next = { ...linkRef.current, current: toGraph(event.clientX, event.clientY) };
      linkRef.current = next;
      setLink(next);
      applyTarget(resolveDrop(event.clientX, event.clientY, next.anchorKind === 'out' ? 'in' : 'out'));
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (pendingRef.current) {
      // Press + release without dragging = focus that port (again = unfocus).
      const pending = pendingRef.current;
      pendingRef.current = null;
      setArmed(false);
      const already =
        props.selected?.kind === 'port' &&
        props.selected.node === pending.focusNode &&
        props.selected.port === pending.focusPort;
      props.onSelect(already ? null : { kind: 'port', node: pending.focusNode, port: pending.focusPort });
      try {
        wrapRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      return;
    }
    if (dragRef.current) {
      const drag = dragRef.current;
      if (drag.moved && drag.kind === 'value') {
        const graph = graphRef.current;
        const value = graph.values.find((v) => v.id === drag.id);
        const target = linkTargetRef.current;
        if (value && value.kind !== 'output') {
          const from: Endpoint = { node: value.id, port: `${value.id}:out` };
          if (target) {
            const error = connectionError(graph, from, target);
            if (error) props.onError(error);
            else {
              props.onMutate((draft) => {
                connect(draft, from, target);
                pruneValues(draft);
                // Snap the pill to the standard slot of the row it now feeds.
                const host = draft.nodes.find((n) => n.id === target.node);
                const pill = draft.values.find((v) => v.id === drag.id);
                if (host && pill) {
                  const index = host.inputs.findIndex((p) => p.id === target.port);
                  pill.position = {
                    x: host.position.x - VALUE_WIDTH - VALUE_GAP,
                    y: host.position.y + NODE_HEADER + Math.max(0, index) * NODE_ROW + NODE_ROW / 2 - VALUE_HEIGHT / 2,
                  };
                }
              }, { history: false });
            }
          } else if (cardAt(event.clientX, event.clientY)) {
            props.onError('这个模块没有可连接的输入端口');
          }
        }
      }
      applyTarget(null);
      if (drag.moved && !drag.duplicated) props.onPushHistory(drag.snapshot);
      dragRef.current = null;
    }
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
    }
    if (linkRef.current) {
      finishLink(event);
    }
    setArmed(false);
    try {
      wrapRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    panRef.current = null;
    linkRef.current = null;
    pendingRef.current = null;
    setLink(null);
    setPanning(false);
    setArmed(false);
    applyTarget(null);
  };

  const selectedNodeId = props.selected?.kind === 'node' ? props.selected.id : undefined;
  const selectedValueId = props.selected?.kind === 'value' ? props.selected.id : undefined;
  const selectedEdgeId = props.selected?.kind === 'edge' ? props.selected.id : undefined;
  const focusPort = props.selected?.kind === 'port' ? { node: props.selected.node, port: props.selected.port } : null;

  const focus = useMemo(() => computeFocus(props.graph, props.selected), [props.selected, props.graph]);
  const showFocus = focus.active || Boolean(focusPort);

  return (
    <div
      ref={wrapRef}
      className={`canvas ${panning ? 'is-panning' : ''} ${link ? 'is-linking' : ''} ${armed ? 'is-armed' : ''} ${dropActive ? 'is-drop-target' : ''} ${showFocus ? 'has-focus' : ''}`}
      style={{
        backgroundPosition: `${props.viewport.x}px ${props.viewport.y}px`,
        backgroundSize: '24px 24px',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        const methodId =
          event.dataTransfer.getData('application/x-flowcode-method') || event.dataTransfer.getData('text/plain');
        if (!methodId) return;
        props.onAddMethod(methodId, toGraph(event.clientX, event.clientY));
      }}
    >
      <div
        className="canvas-world"
        style={{ transform: `translate(${props.viewport.x}px, ${props.viewport.y}px) scale(${props.viewport.zoom})` }}
      >
        <Edges
          graph={props.graph}
          selectedEdge={selectedEdgeId}
          hoveredEdge={hoverEdge}
          focusEdges={focus.edges}
          followEdges={focus.follow}
          focusMode={focus.active}
          onSelect={(id) => props.onSelect({ kind: 'edge', id })}
          onDelete={props.onDeleteEdge}
          onHover={setHoverEdge}
        />
        {props.graph.values.filter((value) => !value.hidden).map((value) => (
          <ValueNodeView
            key={value.id}
            node={value}
            graph={props.graph}
            selected={value.id === selectedValueId}
            dimmed={focus.active && !focus.nodes.has(value.id)}
            focusPort={focusPort}
            linkTarget={linkTarget}
            onSelect={() => props.onSelect({ kind: 'value', id: value.id })}
            onDelete={() => props.onDeleteValue(value.id)}
          />
        ))}
        {props.graph.nodes.map((node) => (
          <MethodNodeView
            key={node.id}
            node={node}
            graph={props.graph}
            selected={node.id === selectedNodeId}
            dimmed={focus.active && !focus.nodes.has(node.id)}
            focusPort={focusPort}
            linkTarget={linkTarget}
            onSelect={() => props.onSelect({ kind: 'node', id: node.id })}
            onReveal={(line, character) => props.onReveal(line, character)}
            onDelete={() => props.onDeleteNode(node.id)}
            onEditParam={props.onEditParam}
          />
        ))}
        {/* Preview line above the cards so the drop target stays readable. */}
        {link && (
          <svg className="edges edges-overlay" width="1" height="1" aria-hidden="true">
            <path
              className="edge-ghost"
              d={edgeGeometry(link.start, linkTarget ? portPosition(props.graph, linkTarget) : link.current).d}
              markerEnd="url(#fc-arrow-any)"
            />
          </svg>
        )}
      </div>

      <div className="canvas-signature">
        <span className="sig-pill">
          <span className="sig-name">
            {props.graph.cells ? props.graph.name : props.graph.entryKind === 'module' ? '模块级流程' : props.graph.name}
          </span>
          <span className="sig-params">
            {props.graph.params.length
              ? `(${props.graph.params.map((p) => p.name).join(', ')})`
              : '()'}
          </span>
          {props.graph.returns.length > 0 && <span className="sig-arrow">→</span>}
          {props.graph.returns.length > 0 && (
            <span className="sig-returns">{props.graph.returns.map((r) => r.name).join(', ')}</span>
          )}
        </span>
        <span className="sig-mode">{props.orientation === 'vertical' ? '纵向数据流' : '横向数据流'}</span>
      </div>

      {showFocus && (
        <div className={`focus-pill ${focus.portSide ? 'is-port' : ''}`}>
          <Link2 size={13} />
          <span className="focus-label">
            {focus.portSide ? `端口 ${focus.title}` : `聚焦：${focus.title}`}
          </span>
          {focus.summary && (
            <span className="focus-sub" title={focus.summary}>
              {focus.summary}
            </span>
          )}
          <button onClick={() => props.onSelect(null)} title="取消聚焦">×</button>
        </div>
      )}

      <div className="canvas-zoom">
        <button onClick={() => zoomCenter(1.15)} title="放大">
          +
        </button>
        <span>{Math.round(props.viewport.zoom * 100)}%</span>
        <button onClick={() => zoomCenter(0.87)} title="缩小">
          −
        </button>
        <button onClick={fit} title="适应窗口">
          <Fit size={13} />
        </button>
      </div>

      {props.graph.nodes.length === 0 && <EmptyState onAddSample={props.onAddSample} onRefresh={props.onRefresh} />}

      {props.syncing && (
        <div className="parse-pill">
          <span className="spinner" /> 正在解析代码
        </div>
      )}

      <div className="canvas-hint">
        <span className="hint-dot" />
        点击端口看后续 · 拖动模块移动 · 滚轮缩放 · Alt+拖动复制
      </div>
    </div>
  );
}
