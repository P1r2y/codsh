export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

const icons = {
  speed:'<path d="M3 12a8 8 0 1 1 14 0M10 10l4-4"/><circle cx="10" cy="10" r="1"/>',
  token:'<ellipse cx="10" cy="4" rx="6" ry="2.5"/><path d="M4 4v10c0 3 12 3 12 0V4M4 8c0 3 12 3 12 0M4 12c0 3 12 3 12 0"/>',
  context:'<circle cx="10" cy="10" r="7" opacity=".35"/><path d="M10 3a7 7 0 0 1 7 7"/>'
};

export function iconSvg(icon) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');svg.innerHTML=icons[icon];return svg;
}
