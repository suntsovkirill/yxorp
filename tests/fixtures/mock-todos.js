// A stateful CRUD mock: POST adds a todo to ctx.store, GET lists them.
module.exports = async (req, res, ctx) => {
  const todos = ctx.store.get('todos') ?? [];

  if (req.method === 'POST') {
    const todo = { id: todos.length + 1, ...(await req.json()) };
    ctx.store.set('todos', [...todos, todo]);
    res.statusCode = 201;
    res.end(JSON.stringify(todo));
    return;
  }

  res.end(JSON.stringify(todos));
};
