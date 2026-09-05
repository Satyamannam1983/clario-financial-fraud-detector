let runtime = null;

function attach(deps) {
  runtime = deps;
  return runtime;
}

function getRuntime() {
  if (!runtime) throw new Error('Clario AI runtime is not attached');
  return runtime;
}

module.exports = { attach, getRuntime };
