import compress from "@fastify/compress";
import fp from "fastify-plugin";

export default fp(async function compression(fastify, { enabled }) {
    if (enabled) {
        await fastify.register(compress, { global: true });

        // wrap the markup in a podlet render call
        // fastify.addHook("onSend", (request, reply, /** @type {string} */ payload) => {
        //     // @ts-ignore
        //     // reply.compress(payload);
        //     reply.send("Nah ahhh")
        //     // done();
        //     return reply;
        // });
      }
});
