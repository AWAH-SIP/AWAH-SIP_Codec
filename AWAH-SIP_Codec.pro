QT += core
QT -= gui

CONFIG += c++11 console
CONFIG -= app_bundle

# You can make your code fail to compile if it uses deprecated APIs.
# In order to do so, uncomment the following line.
#DEFINES += QT_DISABLE_DEPRECATED_BEFORE=0x060000    # disables all the APIs deprecated before Qt 6.0.0

SOURCES += \
        main.cpp

include(awah-sip_library/awahsiplib.pri)

RC_ICONS = images/AWAH_logo_sm.ico

linux-g++ {
    isEmpty(PREFIX) {
        PREFIX = /usr
    }
    target.path = $$PREFIX/bin

    desktop.path = $$PREFIX/share/applications/
    desktop.files += AWAH-SIP_Codec.desktop
    icon40.path = $$PREFIX/share/icons/hicolor/40x40/apps
    icon40.files += images/AWAH_logo_sm.png

    INSTALLS += icon40 desktop target
}

target.path = /opt/AWAH-SIP_Codec/bin
INSTALLS += target
