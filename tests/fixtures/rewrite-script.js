module.exports = (body) => {
  const data = JSON.parse(body.toString());
  data.rewritten = true;
  data.originalSource = data.source;
  data.source = 'rewrite-script';
  return Buffer.from(JSON.stringify(data));
};
