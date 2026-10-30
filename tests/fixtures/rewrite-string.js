module.exports = (body) => {
  const data = JSON.parse(body.toString());
  return JSON.stringify({ greeting: `Привет, ${data.name}` });
};
