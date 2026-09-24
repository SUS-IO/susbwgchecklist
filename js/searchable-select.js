/* ===========================================================
   IEC-BWG — searchable-select.js
   Lightweight searchable combobox. Value must come from the
   option list (typing free text that doesn't match an option
   clears the value on blur) — behaves like a strict dropdown,
   just with type-to-filter.
   =========================================================== */
function createSearchableSelect(container, opts){
  opts = opts || {};
  const placeholder = opts.placeholder || 'Search…';

  container.classList.add('ss-wrap');
  container.innerHTML = `
    <input type="text" class="ss-input" placeholder="${placeholder}" autocomplete="off">
    <span class="ss-caret">▾</span>
    <div class="ss-list"></div>
  `;
  const input = container.querySelector('.ss-input');
  const list = container.querySelector('.ss-list');

  let options = [];       // full list of strings
  let filtered = [];
  let value = '';
  let highlightIndex = -1;
  let changeCb = null;

  function render(){
    list.innerHTML = '';
    if (filtered.length === 0){
      const div = document.createElement('div');
      div.className = 'ss-empty';
      div.textContent = 'No matches';
      list.appendChild(div);
      return;
    }
    filtered.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'ss-option' + (i === highlightIndex ? ' hl' : '');
      div.textContent = opt;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select(opt);
      });
      list.appendChild(div);
    });
  }

  function open(){
    filtered = filterOptions(input.value);
    highlightIndex = -1;
    container.classList.add('open');
    render();
  }
  function close(){
    container.classList.remove('open');
  }
  function filterOptions(q){
    q = (q || '').trim().toLowerCase();
    if (!q) return options.slice();
    return options.filter(o => o.toLowerCase().includes(q));
  }
  function select(opt){
    value = opt;
    input.value = opt;
    close();
    if (changeCb) changeCb(value);
  }

  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', () => {
    filtered = filterOptions(input.value);
    highlightIndex = -1;
    container.classList.add('open');
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown'){
      e.preventDefault();
      if (!container.classList.contains('open')) return open();
      highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
      render();
    } else if (e.key === 'ArrowUp'){
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      render();
    } else if (e.key === 'Enter'){
      e.preventDefault();
      if (highlightIndex >= 0 && filtered[highlightIndex]) select(filtered[highlightIndex]);
    } else if (e.key === 'Escape'){
      close();
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      close();
      // enforce a value that exists in the option list
      if (input.value !== value){
        if (options.includes(input.value)){
          select(input.value);
        } else {
          input.value = value; // revert to last valid selection
        }
      }
    }, 120);
  });

  return {
    setOptions(list_, opts_){
      options = list_ || [];
      if (opts_ && opts_.keepValueIfPresent === false){
        value = ''; input.value = '';
      } else if (value && !options.includes(value)){
        value = ''; input.value = '';
      }
    },
    getValue(){ return value; },
    setValue(v, silent){
      value = v || '';
      input.value = value;
      if (!silent && changeCb) changeCb(value);
    },
    clear(){ value = ''; input.value = ''; },
    onChange(cb){ changeCb = cb; },
    setDisabled(bool){ input.disabled = !!bool; },
    focusEl(){ return input; }
  };
}
