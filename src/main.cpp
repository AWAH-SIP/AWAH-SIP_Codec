#include <QCoreApplication>
#include <QSettings>

#include "src/AWAH-SIP_Codec_Config.h"
#include "../awah-sip_library/include/awahsiplib.h"

int main(int argc, char *argv[])
{
    QCoreApplication a(argc, argv);

    QSettings settings("awah", "AWAH-Sip_Codec");
    QCoreApplication::setOrganizationName("awah");
    QCoreApplication::setOrganizationDomain("awah.ch");
    QCoreApplication::setApplicationName("AWAH-Sip_Codec");
    QCoreApplication::setApplicationVersion("AWAH_SIP_Codec_VERSION");

    AWAHSipLib::prepareLib();
    AWAHSipLib::instance(&a);

    return a.exec();
}
