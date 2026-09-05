const START = '__start__';
const END = '__end__';

class StateGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.conditionals = [];
    this.entry = null;
  }

  addNode(name, fn) {
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from, to) {
    if (from === START) this.entry = to;
    this.edges.push({ from, to });
    return this;
  }

  addConditionalEdges(from, router, mapping) {
    this.conditionals.push({ from, router, mapping });
    return this;
  }

  compile() {
    const graph = this;
    return {
      async invoke(input = {}) {
        const state = { ...input, steps: input.steps || [] };
        let current = graph.entry;
        let hops = 0;
        while (current && current !== END) {
          if (++hops > 40) throw new Error('Agent graph exceeded hop limit');
          const node = graph.nodes.get(current);
          if (!node) throw new Error(`Unknown graph node: ${current}`);
          const patch = await node(state);
          if (patch && typeof patch === 'object') Object.assign(state, patch);
          const conditional = graph.conditionals.find(item => item.from === current);
          if (conditional) {
            const key = await conditional.router(state);
            current = conditional.mapping[key] || END;
          } else {
            current = graph.edges.find(item => item.from === current)?.to || END;
          }
        }
        return state;
      }
    };
  }
}

module.exports = { StateGraph, START, END };
