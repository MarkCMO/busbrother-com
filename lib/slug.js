function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { toSlug, titleCase };
