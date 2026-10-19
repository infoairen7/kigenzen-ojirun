(function(){
  function mk(name){
    const target = function(){};
    const store = {};
    const p = new Proxy(target, {
      get(t, k){
        if (k === Symbol.toPrimitive) return () => NaN;
        if (k === Symbol.iterator) return function*(){};
        if (k === 'then') return undefined;
        if (k === 'toJSON') return () => null;
        if (k in store) return store[k];
        return (store[k] = mk(name + '.' + String(k)));
      },
      set(t, k, v){ store[k] = v; return true; },
      apply(){ return mk(name + '()'); },
      construct(){ return mk('new ' + name); },
      has(){ return true; }
    });
    return p;
  }
  window.THREE = mk('THREE');
})();
