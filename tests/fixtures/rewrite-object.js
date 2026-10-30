module.exports = (body) => {
  const items = JSON.parse(body.toString());
  return { count: items.length, rewritten: 'объект' };
};
