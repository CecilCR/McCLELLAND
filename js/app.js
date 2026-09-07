import { initializeApp } from "firebase/app";
import {
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
    signOut, onAuthStateChanged
} from "firebase/auth";
import {
    getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc
} from "firebase/firestore";

// Configuración del proyecto "mcclelland-e8520"
const firebaseConfig = {
  const firebaseConfig = {
  apiKey: "AIzaSyC8r56b9Db_JlwX-YAiJTBXEOJaCW9ehrQ",
  authDomain: "mcclelland-e8520.firebaseapp.com",
  projectId: "mcclelland-e8520",
  storageBucket: "mcclelland-e8520.firebasestorage.app",
  messagingSenderId: "632722832584",
  appId: "1:632722832584:web:978680671ba96dbd1839fd"
};


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- Estado del simulador ----
let preguntas = [];
let preguntaActual = 0;
let opcionSeleccionada = null;
let respuestasUsuario = []; // { preguntaId, titulo, perfil, peso }
let perfilesTotal = { poder: 0, afiliacion: 0, logro: 0 };

const PERFILES_VALIDOS = ["poder", "afiliacion", "logro"];
const ETIQUETAS_PERFIL = { poder: "Poder", afiliacion: "Afiliación", logro: "Logro" };

// Normaliza un texto quitando tildes y pasando a minúsculas, para que
// "afiliación", "Afiliación" y "afiliacion" se traten como el mismo valor
// sin importar cómo se haya escrito el dato en Firestore.
function normalizarPerfil(valor) {
    if (typeof valor !== 'string') return valor;
    return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ---------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------

async function registrarUsuario(email, password, nombre) {
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "usuarios", cred.user.uid), { nombre, email });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function iniciarSesion(email, password) {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

window.mostrarLogin = function () {
    document.getElementById('seccion-login').classList.remove('oculto');
    document.getElementById('seccion-registro').classList.add('oculto');
};

window.mostrarRegistro = function () {
    document.getElementById('seccion-login').classList.add('oculto');
    document.getElementById('seccion-registro').classList.remove('oculto');
};

window.cerrarSesion = async function () {
    await signOut(auth);
};

function limpiarMensaje(id) {
    document.getElementById(id).innerHTML = '';
}

function mostrarMensaje(id, texto, tipo) {
    document.getElementById(id).innerHTML = `<div class="mensaje ${tipo}">${texto}</div>`;
}

function traducirErrorAuth(mensajeCrudo) {
    if (mensajeCrudo.includes('email-already-in-use')) return 'Ya existe una cuenta con este correo. Inicia sesión.';
    if (mensajeCrudo.includes('weak-password')) return 'Contraseña demasiado débil (mínimo 6 caracteres)';
    if (mensajeCrudo.includes('invalid-credential')) return 'Correo o contraseña incorrectos';
    if (mensajeCrudo.includes('wrong-password')) return 'Contraseña incorrecta';
    if (mensajeCrudo.includes('user-not-found')) return 'No existe una cuenta con este correo';
    if (mensajeCrudo.includes('invalid-email')) return 'Correo electrónico inválido';
    return mensajeCrudo;
}

document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    limpiarMensaje('login-mensaje');

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    const resultado = await iniciarSesion(email, password);
    btn.disabled = false;

    if (!resultado.success) {
        mostrarMensaje('login-mensaje', `❌ ${traducirErrorAuth(resultado.error)}`, 'error');
    }
});

document.getElementById('btn-registro').addEventListener('click', async () => {
    const nombre = document.getElementById('registro-nombre').value.trim();
    const email = document.getElementById('registro-email').value.trim();
    const password = document.getElementById('registro-password').value;
    limpiarMensaje('registro-mensaje');

    const btn = document.getElementById('btn-registro');
    btn.disabled = true;
    const resultado = await registrarUsuario(email, password, nombre);
    btn.disabled = false;

    if (!resultado.success) {
        mostrarMensaje('registro-mensaje', `❌ ${traducirErrorAuth(resultado.error)}`, 'error');
    }
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.mostrarLogin();
        document.getElementById('seccion-app').classList.add('oculto');
        return;
    }

    try {
        console.log("✅ Usuario autenticado:", user.uid);

        // Datos de perfil (nombre a mostrar). Si no existe el documento
        // (p.ej. una cuenta creada directo en Authentication), no bloqueamos
        // el acceso: usamos el correo como respaldo.
        let nombreMostrar = user.email;
        try {
            const usuarioSnap = await getDoc(doc(db, "usuarios", user.uid));
            if (usuarioSnap.exists() && usuarioSnap.data().nombre) {
                nombreMostrar = usuarioSnap.data().nombre;
            } else {
                console.warn("⚠️ No hay documento en usuarios/ para este uid; se usa el correo como nombre.");
            }
        } catch (e) {
            console.warn("⚠️ No se pudo leer usuarios/{uid}:", e.message);
        }

        document.getElementById('usuario-nombre').textContent = nombreMostrar;
        document.getElementById('seccion-login').classList.add('oculto');
        document.getElementById('seccion-registro').classList.add('oculto');
        document.getElementById('seccion-app').classList.remove('oculto');

        await cargarPreguntas();
        iniciarSimulador();

    } catch (error) {
        console.error("❌ Error al inicializar la app:", error);
        window.mostrarLogin();
    }
});

// ---------------------------------------------------------------
// CARGA DE PREGUNTAS
// ---------------------------------------------------------------

async function cargarPreguntas() {
    try {
        console.log("📡 Cargando preguntas desde Firestore...");
        const snapshot = await getDocs(collection(db, "preguntas"));

        preguntas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        preguntas.forEach(p => {
            if (typeof p.orden !== 'number') {
                console.warn(`⚠️ La pregunta "${p['título']}" (id: ${p.id}) no tiene un campo "orden" numérico y se colocará al final.`);
            }
        });
        preguntas.sort((a, b) =>
            (typeof a.orden === 'number' ? a.orden : Infinity) -
            (typeof b.orden === 'number' ? b.orden : Infinity)
        );

        if (preguntas.length === 0) {
            document.getElementById('pregunta-titulo').textContent = 'Aún no hay preguntas configuradas.';
            document.getElementById('pregunta-contexto').textContent = 'Contacta a tu docente si esto no es lo esperado.';
        }
    } catch (error) {
        console.error("❌ Error al cargar preguntas:", error);
        document.getElementById('pregunta-titulo').textContent = 'No se pudieron cargar las preguntas.';
        document.getElementById('pregunta-contexto').textContent = error.message;
    }
}

// ---------------------------------------------------------------
// SIMULADOR
// ---------------------------------------------------------------

function iniciarSimulador() {
    preguntaActual = 0;
    respuestasUsuario = [];
    perfilesTotal = { poder: 0, afiliacion: 0, logro: 0 };
    opcionSeleccionada = null;

    document.getElementById('resultados').classList.add('oculto');
    document.getElementById('simulador').classList.remove('oculto');

    if (preguntas.length > 0) mostrarPregunta();
}

function mostrarPregunta() {
    opcionSeleccionada = null;
    const pregunta = preguntas[preguntaActual];

    document.getElementById('pregunta-contexto').textContent = pregunta.contexto || '';
    document.getElementById('pregunta-titulo').textContent = pregunta['título'] || '(sin título)';

    const barraProgreso = document.getElementById('barra-progreso');
    barraProgreso.style.width = `${Math.round((preguntaActual / preguntas.length) * 100)}%`;

    const contenedor = document.getElementById('opciones-container');
    contenedor.innerHTML = '';

    (pregunta.opciones || []).forEach((opcion, index) => {
        const btn = document.createElement('button');
        btn.className = 'opcion';
        btn.textContent = opcion.texto || '(sin texto)';
        btn.addEventListener('click', () => window.seleccionarOpcion(index));
        contenedor.appendChild(btn);
    });

    document.getElementById('retroalimentacion').classList.add('oculto');
    const btnSiguiente = document.getElementById('btn-siguiente');
    btnSiguiente.disabled = true;
    btnSiguiente.textContent = (preguntaActual === preguntas.length - 1) ? 'Finalizar' : 'Siguiente';
}

window.seleccionarOpcion = function (index) {
    if (opcionSeleccionada !== null) return; // ya respondida
    opcionSeleccionada = index;

    const pregunta = preguntas[preguntaActual];
    const opcion = pregunta.opciones[index];

    // Validación defensiva: perfil debe ser uno de los tres válidos
    // (ignorando tildes/mayúsculas), peso debe ser numérico. Si no,
    // se avisa en consola y no se suma nada.
    const perfil = normalizarPerfil(opcion.perfil);
    let peso = Number(opcion.peso);
    if (!PERFILES_VALIDOS.includes(perfil)) {
        console.warn(`⚠️ La opción ${index} de la pregunta "${pregunta['título']}" (id: ${pregunta.id}) tiene un "perfil" inválido:`, opcion.perfil);
        peso = 0;
    } else if (isNaN(peso)) {
        console.warn(`⚠️ La opción ${index} de la pregunta "${pregunta['título']}" (id: ${pregunta.id}) no tiene un "peso" numérico. Valor recibido:`, opcion.peso);
        peso = 0;
    } else {
        perfilesTotal[perfil] += peso;
    }

    respuestasUsuario.push({
        preguntaId: pregunta.id,
        titulo: pregunta['título'],
        perfil: PERFILES_VALIDOS.includes(perfil) ? perfil : null,
        peso: isNaN(Number(opcion.peso)) ? 0 : Number(opcion.peso)
    });

    // Marcar visualmente la opción elegida y deshabilitar las demás
    document.querySelectorAll('#opciones-container .opcion').forEach((btn, i) => {
        btn.disabled = true;
        if (i === index) btn.classList.add('seleccionada');
    });

    // Mostrar retroalimentación (descriptiva, nunca "correcto/incorrecto")
    const cajaRetro = document.getElementById('retroalimentacion');
    cajaRetro.textContent = opcion.retroalimentación || '';
    cajaRetro.classList.remove('oculto');

    document.getElementById('btn-siguiente').disabled = false;
};

document.getElementById('btn-siguiente').addEventListener('click', () => {
    preguntaActual++;
    if (preguntaActual < preguntas.length) {
        mostrarPregunta();
    } else {
        mostrarResultadosFinales();
    }
});

// ---------------------------------------------------------------
// RESULTADOS
// ---------------------------------------------------------------

function mostrarResultadosFinales() {
    document.getElementById('simulador').classList.add('oculto');
    document.getElementById('resultados').classList.remove('oculto');

    const total = perfilesTotal.poder + perfilesTotal.afiliacion + perfilesTotal.logro;

    PERFILES_VALIDOS.forEach(perfil => {
        const porcentaje = total > 0 ? Math.round((perfilesTotal[perfil] / total) * 100) : 0;
        document.getElementById(`porcentaje-${perfil}`).textContent = `${porcentaje}%`;
        document.getElementById(`barra-${perfil}`).style.width = `${porcentaje}%`;
    });

    let dominante = null;
    if (total > 0) {
        dominante = PERFILES_VALIDOS.reduce((a, b) => perfilesTotal[a] >= perfilesTotal[b] ? a : b);
    }
    document.getElementById('perfil-dominante').textContent = dominante
        ? `Tu perfil predominante: orientación a ${ETIQUETAS_PERFIL[dominante]}`
        : 'No se registraron respuestas suficientes para determinar un perfil.';

    const resumen = document.getElementById('resumen-respuestas');
    resumen.innerHTML = '';
    respuestasUsuario.forEach((r, idx) => {
        const div = document.createElement('div');
        div.className = 'resumen-item';
        const spanTitulo = document.createElement('span');
        spanTitulo.textContent = `${idx + 1}. ${r.titulo}`;
        const spanPerfil = document.createElement('span');
        spanPerfil.textContent = r.perfil ? ETIQUETAS_PERFIL[r.perfil] : '—';
        div.appendChild(spanTitulo);
        div.appendChild(spanPerfil);
        resumen.appendChild(div);
    });

    guardarRespuestas();
}

async function guardarRespuestas() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
        for (const r of respuestasUsuario) {
            await addDoc(collection(db, "respuestas"), {
                usuarioId: uid,
                preguntaId: r.preguntaId,
                perfil: r.perfil,
                peso: r.peso,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error("❌ Error al guardar respuestas:", error);
    }
}

window.reiniciarSimulador = function () {
    iniciarSimulador();
};
