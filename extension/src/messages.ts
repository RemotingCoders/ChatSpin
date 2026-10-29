import {useI18n} from '../../src/i18n';
const messages:Record<string,[string,string,string]>={
 'Move ChatSpin panel':['Mover panel de ChatSpin','ChatSpin-Panel verschieben','Переместить панель ChatSpin'],
 'Drag to move. Arrow keys move; Home resets.':['Arrastrá para mover. Las flechas mueven; Inicio restablece.','Zum Verschieben ziehen. Pfeiltasten bewegen; Pos1 setzt zurück.','Перетащите для перемещения. Стрелки перемещают; Home сбрасывает.'],
 'Follow channel language':['Seguir idioma del canal','Sprache des Kanals übernehmen','Использовать язык канала'],
 'Open this view inside Twitch, or use the local preview.':['Abrí esta vista dentro de Twitch o usá la vista previa local.','Öffne diese Ansicht in Twitch oder nutze die lokale Vorschau.','Откройте эту страницу в Twitch или используйте локальный просмотр.'],
 'Local preview is available only in development.':['La vista previa local solo está disponible en desarrollo.','Die lokale Vorschau ist nur in der Entwicklung verfügbar.','Локальный просмотр доступен только в режиме разработки.'],
 'Local extension preview':['Vista previa local de la extensión','Lokale Erweiterungsvorschau','Локальный просмотр расширения'],
 'Waiting for Twitch authorization…':['Esperando autorización de Twitch…','Warten auf Twitch-Autorisierung…','Ожидание авторизации Twitch…'],
 'Preview as viewer':['Probar como espectador','Als Zuschauer testen','Просмотр от лица зрителя'],
 'Preview as streamer':['Probar como streamer','Als Streamer testen','Просмотр от лица стримера'],
 'Your language changes only your view. The draw is shared by everyone.':['Tu idioma cambia solo tu vista. El sorteo es el mismo para todos.','Deine Sprache ändert nur deine Ansicht. Die Auslosung ist für alle gleich.','Язык меняет только ваше отображение. Результат розыгрыша общий для всех.'],
 'Extension setup':['Configuración de la extensión','Erweiterung einrichten','Настройка расширения'],
 'Use the existing dashboard to connect Twitch chat and configure the channel.':['Usá el panel para conectar el chat de Twitch y configurar tu canal.','Verbinde den Twitch-Chat und richte deinen Kanal im Dashboard ein.','Подключите чат Twitch и настройте канал через панель управления.'],
 'Open streamer dashboard ↗':['Abrir panel del streamer ↗','Streamer-Dashboard öffnen ↗','Открыть панель стримера ↗'],
 'Share your Twitch identity to participate.':['Compartí tu identidad de Twitch para participar.','Teile deine Twitch-Identität, um teilzunehmen.','Поделитесь своей учётной записью Twitch для участия.'],
 'Share identity with ChatSpin':['Compartir identidad con ChatSpin','Identität mit ChatSpin teilen','Поделиться учётной записью с ChatSpin'],
 'Close registration':['Cerrar inscripción','Anmeldung schließen','Закрыть регистрацию'],
 'On':['Activado','An','Включено'],
 'Off':['Desactivado','Aus','Выключено'],
 'Extension backend URL is not configured.':['No está configurada la dirección del servidor de la extensión.','Die Backend-Adresse der Erweiterung ist nicht eingerichtet.','Адрес сервера расширения не настроен.'],
 'Twitch extension is not configured.':['La extensión de Twitch no está configurada.','Die Twitch-Erweiterung ist nicht eingerichtet.','Расширение Twitch не настроено.'],
 'Invalid or expired extension authorization.':['La autorización de la extensión es inválida o venció.','Die Erweiterungsautorisierung ist ungültig oder abgelaufen.','Авторизация расширения недействительна или истекла.'],
 'Extension origin rejected.':['Origen de la extensión rechazado.','Ursprung der Erweiterung abgelehnt.','Источник расширения отклонён.'],
 'Extension origin required.':['Falta el origen de la extensión.','Der Ursprung der Erweiterung ist erforderlich.','Требуется источник расширения.'],
 'Channel is processing. Please try again shortly.':['El canal está procesando datos. Volvé a intentar en un momento.','Der Kanal verarbeitet Daten. Bitte versuche es gleich erneut.','Канал обрабатывает данные. Повторите попытку чуть позже.'],
 'Cloud request failed. Please retry.':['Falló la solicitud al servidor. Volvé a intentar.','Die Serveranfrage ist fehlgeschlagen. Bitte erneut versuchen.','Ошибка запроса к серверу. Повторите попытку.']
};
export function useExtensionI18n(){const base=useI18n();return {...base,t:(key:string,values?:Record<string,string|number>)=>{const entry=messages[key],index=base.language==='es'?0:base.language==='de'?1:base.language==='ru'?2:-1;return entry&&index>=0?entry[index as 0|1|2]:base.t(key,values);}};}
