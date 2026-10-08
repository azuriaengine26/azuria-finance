package com.azuriaengine.finance;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import static androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG;

/**
 * Fingerprint unlock for Azuria Finance.
 *
 * The app PIN is encrypted with an AES-256-GCM key that lives in the Android Keystore (hardware-backed
 * where available). The key can only be used immediately after a successful strong-biometric scan
 * (setUserAuthenticationRequired + a BiometricPrompt CryptoObject), and Android destroys it if the set
 * of enrolled fingerprints changes. Only ciphertext is stored in app-private preferences.
 */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricVaultPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "azuria_finance_biometric_pin";
    private static final String PREFS = "azuria_finance_biometric";

    private interface CipherAction { void run(Cipher cipher) throws Exception; }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String reasonName(int code) {
        switch (code) {
            case BiometricManager.BIOMETRIC_SUCCESS: return "ok";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "none_enrolled";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "no_hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE: return "unavailable";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: return "security_update_required";
            default: return "unsupported";
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        int code = BiometricManager.from(getContext()).canAuthenticate(BIOMETRIC_STRONG);
        JSObject ret = new JSObject();
        ret.put("available", code == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("reason", reasonName(code));
        ret.put("enrolled", prefs().contains("ct") && keyExists());
        call.resolve(ret);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        final String secret = call.getString("secret");
        if (secret == null || secret.isEmpty()) { call.reject("Missing secret", "BAD_REQUEST"); return; }
        try {
            clear();
            SecretKey key = createKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            prompt(call, cipher, call.getString("title", "Turn on fingerprint unlock"), call.getString("subtitle", "Confirm with your fingerprint"), c -> {
                byte[] ct = c.doFinal(secret.getBytes(StandardCharsets.UTF_8));
                prefs().edit()
                    .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                    .putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                    .apply();
                call.resolve();
            });
        } catch (Exception e) {
            clear();
            call.reject("Could not set up fingerprint unlock: " + e.getMessage(), "SETUP_FAILED", e);
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String ctB64 = prefs().getString("ct", null);
        String ivB64 = prefs().getString("iv", null);
        if (ctB64 == null || ivB64 == null) { call.reject("Fingerprint unlock is not set up", "NOT_ENROLLED"); return; }
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            SecretKey key = (SecretKey) ks.getKey(KEY_ALIAS, null);
            if (key == null) { clear(); call.reject("Fingerprint key is gone", "KEY_INVALIDATED"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            try {
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)));
            } catch (KeyPermanentlyInvalidatedException e) {
                clear();
                call.reject("Fingerprints on this phone changed", "KEY_INVALIDATED");
                return;
            }
            final byte[] ct = Base64.decode(ctB64, Base64.NO_WRAP);
            prompt(call, cipher, call.getString("title", "Unlock Azuria Finance"), call.getString("subtitle", "Use your fingerprint"), c -> {
                String secret = new String(c.doFinal(ct), StandardCharsets.UTF_8);
                JSObject ret = new JSObject();
                ret.put("secret", secret);
                call.resolve(ret);
            });
        } catch (Exception e) {
            call.reject("Fingerprint unlock failed: " + e.getMessage(), "ERROR", e);
        }
    }

    @PluginMethod
    public void disable(PluginCall call) {
        clear();
        call.resolve();
    }

    private void prompt(PluginCall call, Cipher cipher, String title, String subtitle, CipherAction onSuccess) {
        final FragmentActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                    if (crypto == null || crypto.getCipher() == null) { call.reject("No key returned", "ERROR"); return; }
                    try { onSuccess.run(crypto.getCipher()); }
                    catch (Exception e) { call.reject("Fingerprint unlock failed: " + e.getMessage(), "ERROR", e); }
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    boolean cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED
                        || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                        || errorCode == BiometricPrompt.ERROR_CANCELED;
                    boolean lockout = errorCode == BiometricPrompt.ERROR_LOCKOUT || errorCode == BiometricPrompt.ERROR_LOCKOUT_PERMANENT;
                    call.reject(errString.toString(), cancelled ? "CANCELLED" : lockout ? "LOCKOUT" : "ERROR_" + errorCode);
                }
                // onAuthenticationFailed (a finger that didn't match) keeps the prompt open; nothing to do.
            });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText("Use PIN")
                .setAllowedAuthenticators(BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .build();
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private SecretKey createKey() throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        gen.init(spec.build());
        return gen.generateKey();
    }

    private boolean keyExists() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            return ks.containsAlias(KEY_ALIAS);
        } catch (Exception e) {
            return false;
        }
    }

    private void clear() {
        prefs().edit().clear().apply();
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) { }
    }
}
