import type { FlowEdge, FlowGraph, Point, PortType } from '../../../src/core/types';
import { findNode, isValueNode, portPosition } from '../../../src/core/graph';

function typeVar(type: PortType): string {
  switch (type) {
    case 'number':
      return '--fc-type-number';
    case 'int':
      return '--fc-type-int';
    case 'string':
      return '--fc-type-string';
    case 'boolean':
      return '--fc-type-bool';
    case 'list':
      return '--fc-type-list';
    case 'dict':
      return '--fc-type-dict';
    default:
      return '--fc-type-any';
  }
}

function edgeType(graph: FlowGraph, edge: FlowEdge): PortType {
  const source = findNode(graph, edge.from.node);
  if (!source) return 'any';
  if (isValueNode(source)) return source.type;
  return source.outputs.find((p) => p.id === edge.from.port)?.type ?? 'any';
}

export function edgeGeometry(from: Point, to: Point): { d: string; mid: Point; c1: Point; c2: Point } {
  const dx = Math.max(52, Math.abs(to.x - from.x) * 0.48);
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  const d = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
  const mid = {
    x: 0.125 * from.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * to.x,
    y: 0.125 * from.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * to.y,
  };
  return { d, mid, c1, c2 };
}

const TYPES: PortType[] = ['number', 'int', 'string', 'boolean', 'list', 'dict', 'any'];

export function Edges({
  graph,
  selectedEdge,
  hoveredEdge,
  focusEdges,
  followEdges,
  focusMode,
  onSelect,
  onDelete,
  onHover,
}: {
  graph: FlowGraph;
  selectedEdge?: string | null;
  hoveredEdge?: string | null;
  focusEdges?: Set<string>;
  /** Highlighted only because they are downstream of the focused port. */
  followEdges?: Set<string>;
  focusMode?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <svg className="edges" width="1" height="1" aria-hidden="true">
      <defs>
        {TYPES.map((type) => (
          <marker
            key={type}
            id={`fc-arrow-${type}`}
            viewBox="0 0 10 10"
            refX="8.2"
            refY="5"
            markerWidth="6.4"
            markerHeight="6.4"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill={`var(${typeVar(type)})`} />
          </marker>
        ))}
      </defs>
      {graph.edges.map((edge) => {
        const from = portPosition(graph, edge.from);
        const to = portPosition(graph, edge.to);
        const type = edgeType(graph, edge);
        const { d, mid } = edgeGeometry(from, to);
        const selected = edge.id === selectedEdge;
        const hovered = edge.id === hoveredEdge;
        const focused = focusMode && Boolean(focusEdges?.has(edge.id));
        const followed = Boolean(followEdges?.has(edge.id));
        const dimmed = focusMode && !focused;
        return (
          <g key={edge.id} className={`edge ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''} ${focused ? 'is-focused' : ''} ${followed ? 'is-follow' : ''} ${dimmed ? 'is-dimmed' : ''}`} data-edge-id={edge.id}>
            <path
              className="edge-hit"
              d={d}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(edge.id);
              }}
              onPointerEnter={() => onHover(edge.id)}
              onPointerLeave={() => onHover(null)}
            />
            <path
              className="edge-line"
              d={d}
              style={{ stroke: `var(${typeVar(type)})` }}
              markerEnd={`url(#fc-arrow-${type})`}
            />
            {selected && (
              <g
                className="edge-delete"
                transform={`translate(${mid.x}, ${mid.y})`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onDelete(edge.id);
                }}
              >
                <circle r="10" />
                <path d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2" />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
