/** Версия формата IR. Обе половины системы сверяют её и отказываются
 *  работать при несовпадении — молчаливая деградация запрещена. */
export const IR_VERSION = 1
export type IrVersion = typeof IR_VERSION
