#!/usr/bin/env python3
"""Roda DEPOIS de `npx cap add android`: paisagem fixa, tela cheia imersiva, tela sempre acesa,
área do entalhe (notch), permissões de vibração, ícone e tela de abertura do app. Falha em voz alta se o modelo do Capacitor mudar."""
import json, os, re, shutil, sys
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
app_id = json.load(open(os.path.join(root, 'capacitor.config.json')))['appId']
man = os.path.join(root, 'android/app/src/main/AndroidManifest.xml')
m = open(man, encoding='utf-8').read()
act = re.search(r'<activity\b[^>]*\.MainActivity[^>]*>', m); assert act, 'MainActivity não encontrada no AndroidManifest.xml'
if 'screenOrientation' not in act.group(0):
    m = m.replace(act.group(0), act.group(0)[:-1] + ' android:screenOrientation="sensorLandscape">', 1)
for perm in ('VIBRATE', 'WAKE_LOCK'):
    tag = f'<uses-permission android:name="android.permission.{perm}" />'
    if tag not in m:
        assert '</manifest>' in m; m = m.replace('</manifest>', f'    {tag}\n</manifest>', 1)
open(man, 'w', encoding='utf-8').write(m)
java_dir = os.path.join(root, 'android/app/src/main/java', *app_id.split('.'))
assert os.path.isdir(java_dir), f'pasta Java não encontrada: {java_dir}'
open(os.path.join(java_dir, 'MainActivity.java'), 'w', encoding='utf-8').write(f'''package {app_id};

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {{
    @Override
    public void onCreate(Bundle savedInstanceState) {{
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {{
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }}
        hideBars();
    }}

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {{
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }}

    private void hideBars() {{
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }}
}}
''')
# O Android descarta por padrão arquivos que começam com ponto (".*"). O jogo tem data/lang/.README.txt
# (listado no manifesto do disco virtual), então mantemos esses arquivos no APK para ficar igual ao original.
gradle = os.path.join(root, 'android/app/build.gradle')
g = open(gradle, encoding='utf-8').read()
pat = re.search(r"ignoreAssetsPattern\s*=\s*'([^']*)'", g); assert pat, 'ignoreAssetsPattern não encontrado no build.gradle'
itens = [i for i in pat.group(1).split(':') if i != '.*']
g = g.replace(pat.group(0), "ignoreAssetsPattern = '" + ':'.join(itens) + "'", 1)
open(gradle, 'w', encoding='utf-8').write(g)
# Ícones e tela de abertura do app (gerados por tools/make_icons.py a partir de assets/icon.png)
res_src, res_dst = os.path.join(root, 'android-res'), os.path.join(root, 'android/app/src/main/res')
assert os.path.isdir(res_dst), 'pasta res do Android não encontrada'
if os.path.isdir(res_src): shutil.copytree(res_src, res_dst, dirs_exist_ok=True)
else: print('aviso: android-res/ ausente; o app fica com o ícone padrão do Capacitor')
print('android customizado: paisagem, imersivo, tela acesa, notch, vibração, arquivos com ponto mantidos, ícone e splash')
