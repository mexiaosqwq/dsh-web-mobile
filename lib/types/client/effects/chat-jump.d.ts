import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * #299: keep the four keys outside the scrollport, use host rows as stops,
 * and delegate history and tail-following to the host. A plain tap or a
 * programmatic scroll with no recent wheel/touch movement keeps them hidden.
 */
export declare function installChatJump(ctx: ClientContext): void;
//# sourceMappingURL=chat-jump.d.ts.map