@echo off
setlocal enabledelayedexpansion
title CW Finance - ע����������

:: ���ļ�Ϊ GBK ���룺�ű���Ԥ�� chcp 65001 ���� set /p ���������룬
:: ��˱���ϵͳĬ�ϴ���ҳ�ʴ�ֻ�ڵ��� Node��UTF-8 �����ʱ��ʱ�е� 65001��
:: ˫��ֱ�ӽ��뽻���ʴ�Ҳ֧�������д��Σ�
::   ����ע����.bat A1B2C3D4E5F6 2027-12-31 gl,cashier
set "MACHINE_ID=%~1"
set "EXPIRES=%~2"
:: cmd Ĭ�ϰѶ���Ҳ�������ָ�����ģ���б����ո�������һ�β��ܱ�ס gl,cashier ����д��
set "MODULES="
for /f "tokens=1,2* delims= " %%a in ("%*") do set "MODULES=%%c"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "GENERATOR=%ROOT%\tools\license-generator\generate-license.mjs"
set "PRIVATE_KEY=%ROOT%\tools\license-keys\license-private.pem"

echo.
echo ========================================
echo   CW Finance ע����������
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [����] δ�ҵ� Node.js�����Ȱ�װ Node.js ���޸� PATH��
    goto FAIL
)
if not exist "%GENERATOR%" (
    echo [����] δ�ҵ����ɽű�: %GENERATOR%
    goto FAIL
)
if not exist "%PRIVATE_KEY%" (
    echo [����] δ�ҵ�˽Կ: %PRIVATE_KEY%
    echo �뽫 license-private.pem �ŵ� tools\license-keys\ Ŀ¼�¡�
    goto FAIL
)

:: �������������������������ʱ�˳�����������ֵ�س����¿�ת
set /a TRY=0
:ASK_MACHINE_ID
if defined MACHINE_ID goto ASK_EXPIRES_INIT
set /a TRY+=1
if !TRY! gtr 5 (
    echo [����] δ��ȡ�������룬���˳���
    goto FAIL
)
set /p "MACHINE_ID=�������û������루12 λ������ҳ�ɸ��ƣ�: "
if not defined MACHINE_ID echo [��ʾ] �����벻��Ϊ�գ����������롣
goto ASK_MACHINE_ID

:ASK_EXPIRES_INIT
set /a TRY=0
:ASK_EXPIRES
if defined EXPIRES goto ASK_MODULES
set /a TRY+=1
if !TRY! gtr 5 (
    echo [����] δ��ȡ����ֹ���ڣ����˳���
    goto FAIL
)
set /p "EXPIRES=��������Ȩ��ֹ���� YYYY-MM-DD�������죩: "
if not defined EXPIRES echo [��ʾ] ��ֹ���ڲ���Ϊ�գ����������롣
goto ASK_EXPIRES

:ASK_MODULES
if defined MODULES goto GENERATE
echo.
echo ---------- ����Ȩģ�� ----------
echo   1. ����        (gl)
echo   2. ���ɹ���    (cashier)
echo   3. �̶��ʲ�    (asset)
echo   4. ������      (scm)
echo   5. ��������    (production)
echo   6. ί�����    (outsource)
echo --------------------------------
echo ��ѡ�ö��ŷָ�������: 1,2  ��  gl,cashier
echo ֱ�ӻس� = ��Ȩȫ��ģ��
echo.
set /p "MODULES=��������Ȩģ��: "
if not defined MODULES set "MODULES=all"

:GENERATE
:: Node ���Ϊ UTF-8���е� 65001 �Ų������룻��ӡ�����л�ԭ����ҳ
set "OLD_CP="
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
set "OLD_CP=!OLD_CP: =!"
chcp 65001 >nul
echo.
node "%GENERATOR%" -m "%MACHINE_ID%" -e "%EXPIRES%" -M "%MODULES%" -k "%PRIVATE_KEY%"
set "NODE_EXIT=!errorlevel!"
if defined OLD_CP chcp !OLD_CP! >nul

if not "!NODE_EXIT!"=="0" (
    echo.
    echo [ʧ��] ע��������ʧ�ܣ������Ϸ���ʾ�����ԡ�
    goto FAIL
)
echo �����������Ϸ�ע���뷢���ͻ�����д����У���
echo.
pause
exit /b 0

:FAIL
echo.
pause
exit /b 1