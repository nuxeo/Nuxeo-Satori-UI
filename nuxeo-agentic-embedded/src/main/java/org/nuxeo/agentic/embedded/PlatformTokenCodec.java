package org.nuxeo.agentic.embedded;

import java.util.Date;
import java.util.Map;

import org.nuxeo.ecm.jwt.JWTClaims;
import org.nuxeo.ecm.jwt.JWTService;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.api.login.NuxeoLoginContext;

/**
 * A panel's token, from the platform's JWT service ({@code org.nuxeo.ecm.jwt.JWTService}, in
 * {@code nuxeo-platform-login-jwt}), signed with the server's {@code nuxeo.jwt.secret}: so that the
 * platform's own authenticator, {@code JWT_AUTH}, which the REST API's chain holds, signs the user in
 * with it, and does so only on a path that starts with its audience, {@code aud}. Nothing here signs
 * or checks a signature itself.
 *
 * Its claims: {@code sub}, the user; {@code aud}, the path it is valid on
 * ({@link EmbeddedSettings#tokenPath()}), a text as the authenticator requires; {@code exp}, from the
 * host's lifetime; {@code iat}; {@code jti}; {@link TokenCodec#HOST}, the host; and
 * {@link TokenCodec#SCOPE}. The service's builder takes its subject from the user signed in, and
 * refuses to build with none, so it is built as the system user and given the user's name.
 */
public final class PlatformTokenCodec implements TokenCodec {

    @Override
    public String issue(Grant grant) {
        JWTService jwt = Framework.getService(JWTService.class);
        if (jwt == null) {
            throw new TokenException("the server has no JWT service", null);
        }
        String token;
        try (NuxeoLoginContext ignored = Framework.loginSystem()) {
            token = jwt.newBuilder()
                       .withTTL(grant.lifetime())
                       .withClaim(JWTClaims.CLAIM_SUBJECT, grant.username())
                       .withClaim(JWTClaims.CLAIM_AUDIENCE, grant.audiencePath())
                       .withClaim(JWTClaims.CLAIM_ISSUED_AT, Date.from(grant.issuedAt()))
                       .withClaim(JWTClaims.CLAIM_JWT_ID, grant.id())
                       .withClaim(HOST, grant.host())
                       .withClaim(SCOPE, grant.scope())
                       .build();
        } catch (RuntimeException e) {
            // Among them, a server with no nuxeo.jwt.secret: the service cannot sign.
            throw new TokenException("the platform's JWT service did not sign the token ("
                    + e.getClass().getSimpleName() + "): is nuxeo.jwt.secret set?", e);
        }
        if (token == null || token.isEmpty()) {
            throw new TokenException("the platform's JWT service signed no token: is nuxeo.jwt.secret set?", null);
        }
        return token;
    }

    @Override
    public Map<String, Object> verify(String token) {
        JWTService jwt = Framework.getService(JWTService.class);
        if (jwt == null || token == null) {
            return null;
        }
        try {
            return jwt.verifyToken(token);
        } catch (RuntimeException e) {
            return null;
        }
    }
}
